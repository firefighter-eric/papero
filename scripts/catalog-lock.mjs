import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function isLivePid(pid) {
  try { process.kill(pid, 0); return true } catch (error) {
    if (error.code === 'ESRCH') return false
    // EPERM and other unknown states never authorize stale-owner recovery.
    return true
  }
}

// Each contender owns a unique atomic lockfile. Ordered tickets serialize the
// read/merge/write operation without a shared stale-file deletion race.
export async function withCatalogLock(dataDir, action, { timeoutMs = 15000, retryMs = 20, directoryName = '.catalog-lock', label = 'Catalog' } = {}) {
  const directory = path.join(dataDir, directoryName)
  await mkdir(directory, { recursive: true })
  const token = randomUUID()
  const ownerFile = path.join(directory, `${token}.json`)
  const temporary = `${ownerFile}.tmp`
  const owner = { token, pid: process.pid, hostname: hostname(), choosing: true, ticket: 0, createdAt: new Date().toISOString() }
  const deadline = Date.now() + timeoutMs
  const publishOwner = async () => {
    await writeFile(temporary, JSON.stringify(owner) + '\n', { flag: 'wx' })
    await rename(temporary, ownerFile)
  }
  const owners = async () => {
    const values = []
    for (const filename of (await readdir(directory)).filter(name => name.endsWith('.json'))) {
      const file = path.join(directory, filename)
      let value
      try { value = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
        if (error.code === 'ENOENT') continue
        throw new Error(`Invalid catalog lock owner: ${filename}`, { cause: error })
      }
      if (filename !== `${value.token}.json` || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.hostname !== 'string' || typeof value.choosing !== 'boolean' || !Number.isSafeInteger(value.ticket) || value.ticket < 0) throw new Error(`Invalid catalog lock metadata: ${filename}`)
      if (value.hostname === owner.hostname && !isLivePid(value.pid)) {
        // This path belongs only to this immutable UUID, so two recoverers
        // cannot accidentally remove a newly acquired owner's lockfile.
        try { await unlink(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
        continue
      }
      values.push(value)
    }
    return values
  }
  try {
    await publishOwner()
    owner.ticket = Math.max(0, ...(await owners()).map(value => value.ticket)) + 1
    owner.choosing = false
    await publishOwner()
    while (true) {
      const current = await owners()
      const blocker = current.find(value => value.token !== token && (value.choosing || value.ticket < owner.ticket || (value.ticket === owner.ticket && value.token < token)))
      if (!blocker) return await action()
      if (Date.now() >= deadline) throw new Error(`${label} lock timed out; active owner PID ${blocker.pid} on ${blocker.hostname}. Existing data was preserved.`)
      await sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())))
    }
  } finally {
    try { await unlink(ownerFile) } catch (error) { if (error.code !== 'ENOENT') throw error }
    try { await unlink(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

export function withExclusivePaperLock(dataDir, id, action) {
  return withCatalogLock(path.join(dataDir, 'papers', id), action, { timeoutMs: 0, directoryName: '.paper-lock', label: `Paper ${id}` })
}
