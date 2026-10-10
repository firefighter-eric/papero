import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { withCatalogLock, withExclusivePaperLock } from './catalog-lock.mjs'
import { updateCatalog } from './import-paper.mjs'

const run = promisify(execFile)
const paper = id => ({ id, title: id, authors: [], tags: [], source: {}, translation: { status: 'pending' }, blocks: [], sections: [] })

test('independent catalog processes retain every new paper and existing order', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-concurrent-catalog-'))
  try {
    await updateCatalog(directory, paper('existing-first'))
    await updateCatalog(directory, paper('existing-second'))
    const moduleUrl = new URL('./import-paper.mjs', import.meta.url).href
    const program = `import {updateCatalog} from ${JSON.stringify(moduleUrl)};
      const [directory,worker]=process.argv.slice(1);
      for(let index=0;index<12;index++) {
        const entry={id:'worker-'+worker+'-paper-'+index,title:'paper',authors:[],tags:[],source:{},translation:{status:'pending'},blocks:[],sections:[]};
        await updateCatalog(directory,entry);
        await updateCatalog(directory,{...entry,id:'existing-first',title:'updated-'+worker+'-'+index});
      }`
    await Promise.all(Array.from({ length: 4 }, (_, worker) => run(process.execPath, ['--input-type=module', '-e', program, directory, String(worker)], { timeout: 20000 })))
    const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'))
    assert.equal(catalog.papers.length, 50)
    assert.deepEqual(catalog.papers.slice(0, 2).map(entry => entry.id), ['existing-first', 'existing-second'])
    assert.equal(new Set(catalog.papers.map(entry => entry.id)).size, 50)
    for (let worker = 0; worker < 4; worker++) for (let index = 0; index < 12; index++) assert.ok(catalog.papers.some(entry => entry.id === `worker-${worker}-paper-${index}`))
    assert.deepEqual(await readdir(path.join(directory, '.catalog-lock')), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('an active catalog owner times out without overwriting the catalog', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-active-catalog-'))
  try {
    await updateCatalog(directory, paper('original'))
    const before = await readFile(path.join(directory, 'catalog.json'), 'utf8')
    await withCatalogLock(directory, async () => {
      await assert.rejects(updateCatalog(directory, paper('must-not-be-written'), { timeoutMs: 40, retryMs: 5 }), /active owner PID/)
      assert.equal(await readFile(path.join(directory, 'catalog.json'), 'utf8'), before)
    })
    assert.deepEqual(await readdir(path.join(directory, '.catalog-lock')), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('a same-host dead PID lock is recovered without deleting live or foreign owners', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-dead-catalog-'))
  try {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    const lockDirectory = path.join(directory, '.catalog-lock')
    await mkdir(lockDirectory)
    const token = randomUUID()
    await writeFile(path.join(lockDirectory, `${token}.json`), JSON.stringify({ token, pid: child.pid, hostname: hostname(), choosing: false, ticket: 1 }))
    await updateCatalog(directory, paper('recovered'))
    assert.equal(JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8')).papers[0].id, 'recovered')
    assert.deepEqual(await readdir(lockDirectory), [])
    const foreignToken = randomUUID(), foreignFile = path.join(lockDirectory, `${foreignToken}.json`)
    await writeFile(foreignFile, JSON.stringify({ token: foreignToken, pid: child.pid, hostname: 'different-host', choosing: false, ticket: 1 }))
    await assert.rejects(updateCatalog(directory, paper('blocked'), { timeoutMs: 30, retryMs: 5 }), /different-host/)
    assert.ok(await readFile(foreignFile, 'utf8'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('same-paper ownership fails before work while distinct papers run concurrently', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-paper-lock-'))
  try {
    let competingActionRan = false
    await withExclusivePaperLock(directory, 'first', async () => {
      await assert.rejects(withExclusivePaperLock(directory, 'first', () => { competingActionRan = true }), /Paper first lock timed out/)
      await withExclusivePaperLock(directory, 'second', async () => { await writeFile(path.join(directory, 'second-finished'), 'yes') })
    })
    assert.equal(competingActionRan, false)
    assert.equal(await readFile(path.join(directory, 'second-finished'), 'utf8'), 'yes')
    assert.deepEqual(await readdir(path.join(directory, 'papers', 'first', '.paper-lock')), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
