import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { concurrencyLimit, createRequestGate, parseLibraryArguments, translateLibrary } from './translate-library.mjs'

test('one shared queue limits concurrent requests from independent papers and rejects invalid limits', async () => {
  const gate = createRequestGate(2)
  let active = 0, peak = 0
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => gate(async () => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 3))
    active--
    return index
  })))
  assert.deepEqual(results, Array.from({ length: 12 }, (_, index) => index))
  assert.equal(peak, 2)
  assert.equal(gate.stats().completed, 12)
  for (const value of [0, 5, '2.5', undefined]) assert.throws(() => concurrencyLimit(value), /1 to 4/)
  assert.deepEqual(parseLibraryArguments(['paper-a', '--concurrency', '4']).ids, ['paper-a'])
  assert.deepEqual(parseLibraryArguments(['--model', 'qwen3.6-35b-a3b', '--allow-model-change']),
    { ids: [], concurrency: 2, help: false, model: 'qwen3.6-35b-a3b', allowModelChange: true })
  assert.throws(() => parseLibraryArguments(['--model']), /exact local API/)
  assert.equal(parseLibraryArguments(['--batch-characters', '3000']).batchCharacters, 3000)
  assert.equal(parseLibraryArguments(['--continue-on-paper-error']).continueOnPaperError, true)
  for (const value of ['255', '6001', '3.5', undefined]) assert.throws(() => parseLibraryArguments(['--batch-characters', value]), /256 to 6000/)
})

test('signal shutdown drains accepted checkpoints, stops queued work and removes both handlers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-signals-'))
  try {
    await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ schemaVersion: 1,
      papers: Array.from({ length: 5 }, (_, index) => ({ id: `paper-${index}` })) }))
    const signalEmitter = new EventEmitter()
    let release, notifyStarted
    const acceptedStarted = new Promise(resolve => { notifyStarted = resolve })
    let requests = 0, checkpoint = false, papers = 0
    const logs = []
    const operation = translateLibrary({ dataDir: directory, concurrency: 1, handleSignals: true, signalEmitter,
      report: value => logs.push(value), translate: async ({ requestGate }) => {
        papers++
        await requestGate(async () => {
          requests++
          notifyStarted()
          await new Promise(resolve => { release = resolve })
          checkpoint = true
        })
        return { translation: { status: 'machine', coverage: { complete: 1, total: 1 } } }
      } })
    const rejection = assert.rejects(operation, error => error.signal === 'SIGINT')
    await acceptedStarted
    signalEmitter.emit('SIGINT')
    signalEmitter.emit('SIGTERM')
    assert.equal(checkpoint, false)
    release()
    await rejection
    assert.equal(checkpoint, true)
    assert.equal(requests, 1)
    assert.equal(papers, 4)
    assert.equal(logs.filter(item => item.type === 'library-translation-draining').length, 1)
    assert.equal(logs.at(-1).requests.active, 0)
    assert.equal(signalEmitter.listenerCount('SIGINT'), 0)
    assert.equal(signalEmitter.listenerCount('SIGTERM'), 0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('stopping a queue rejects queued and future work while letting active work checkpoint', async () => {
  const gate = createRequestGate(1)
  let release
  const active = gate(() => new Promise(resolve => { release = resolve }))
  await Promise.resolve()
  const failure = new Error('request failed')
  const queued = gate(() => assert.fail('queued work must not start'))
  gate.stop(failure)
  await assert.rejects(queued, /request failed/)
  await assert.rejects(gate(() => assert.fail('future work must not start')), /request failed/)
  release('accepted checkpoint')
  assert.equal(await active, 'accepted checkpoint')
})

test('queued requests start FIFO across papers after an occupied slot is released', async () => {
  const gate = createRequestGate(1)
  const started = []
  let release
  const occupied = gate(async () => {
    started.push('occupied')
    await new Promise(resolve => { release = resolve })
  })
  await Promise.resolve()
  const queued = ['paper-a-normal', 'paper-b-correction', 'paper-a-retry'].map(label => gate(async () => { started.push(label) }))
  assert.deepEqual(started, ['occupied'])
  assert.equal(gate.stats().queued, 3)
  release()
  await Promise.all([occupied, ...queued])
  assert.deepEqual(started, ['occupied', 'paper-a-normal', 'paper-b-correction', 'paper-a-retry'])
  assert.equal(gate.stats().completed, 4)
  assert.equal(gate.stats().peak, 1)
})

test('library shares one gate and waits for accepted in-flight work after another paper fails', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-library-'))
  try {
    await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: [{ id: 'first' }, { id: 'second' }] }))
    let accepted = false, started = 0
    const logs = []
    await assert.rejects(translateLibrary({ dataDir: directory, concurrency: 2, report: value => logs.push(value), translate: async ({ id, requestGate }) => {
      await requestGate(async () => {
        started++
        if (id === 'first') throw new Error('controlled failure')
        await new Promise(resolve => setTimeout(resolve, 10))
        accepted = true
      })
      return { translation: { coverage: { complete: 1, total: 1 }, status: 'machine' } }
    } }), /controlled failure/)
    assert.equal(started, 2)
    assert.equal(accepted, true)
    assert.equal(logs.at(-1).completedPapers, 1)
    let contacted = false
    await assert.rejects(translateLibrary({ dataDir: directory, ids: ['absent'], translate: async () => { contacted = true } }), /absent/)
    assert.equal(contacted, false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('resilient mode completes all other papers after a fragment failure and still rejects the incomplete library', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-resilient-library-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const ids = ['failed-paper', 'second', 'third', 'fourth', 'fifth', 'sixth']
  await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: ids.map(id => ({ id })) }))
  const accepted = [], logs = []
  let active = 0, peak = 0
  await assert.rejects(translateLibrary({ dataDir: directory, ids, concurrency: 2, continueOnPaperError: true,
    report: value => logs.push(value), translate: async ({ id, requestGate }) => {
      try {
        await requestGate(async () => {
          active++; peak = Math.max(peak, active)
          try {
            await new Promise(resolve => setTimeout(resolve, 3))
            if (id === ids[0]) throw new Error('invalid fragment')
            accepted.push(id)
          } finally { active-- }
        })
      } catch (error) { requestGate.stop?.(error); throw error }
      return { translation: { status: 'machine', coverage: { complete: 1, total: 1 } } }
    } }), error => error instanceof AggregateError && error.failedPaperIds.length === 1 && error.failedPaperIds[0] === ids[0])
  assert.deepEqual(accepted.sort(), ids.slice(1).sort())
  assert.equal(peak, 2)
  assert.equal(logs.at(-1).completedPapers, 5)
  assert.equal(logs.at(-1).requests.active, 0)
})

test('resilient mode still stops the whole queue on SIGINT and drains accepted work', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-resilient-signal-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: Array.from({ length: 6 }, (_, i) => ({ id: `paper-${i}` })) }))
  const emitter = new EventEmitter()
  let release, notify, started = 0, saved = false
  const ready = new Promise(resolve => { notify = resolve })
  const operation = translateLibrary({ dataDir: directory, concurrency: 1, continueOnPaperError: true,
    handleSignals: true, signalEmitter: emitter, report: () => {}, translate: async ({ requestGate }) => {
      started++
      await requestGate(async () => { notify(); await new Promise(resolve => { release = resolve }); saved = true })
      return { translation: { status: 'machine', coverage: { complete: 1, total: 1 } } }
    } })
  const rejection = assert.rejects(operation, error => error.signal === 'SIGINT')
  await ready
  emitter.emit('SIGINT')
  release()
  await rejection
  assert.equal(saved, true)
  assert.equal(started, 4)
  assert.equal(emitter.listenerCount('SIGINT'), 0)
})

test('six-paper library prepares at most four papers, caps all requests at two, and prioritizes pending large papers without rewriting catalog', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-six-paper-library-'))
  try {
    const papers = [
      { id: 'done-large', translationStatus: 'machine', blockCount: 9999 },
      { id: 'pending-small', translationStatus: 'pending', blockCount: 10 },
      { id: 'pending-large', translationStatus: 'pending', blockCount: 900 },
      { id: 'done-small', translationStatus: 'machine', blockCount: 5 },
      { id: 'pending-medium', translationStatus: 'pending', blockCount: 300 },
      { id: 'pending-mid-small', translationStatus: 'pending', blockCount: 50 },
    ]
    const catalogFile = path.join(directory, 'catalog.json')
    await writeFile(catalogFile, JSON.stringify({ schemaVersion: 1, papers }, null, 2) + '\n')
    const before = await readFile(catalogFile)
    let prepared = 0, peakPrepared = 0, activeRequests = 0, peakRequests = 0, completedRequests = 0
    const started = [], logs = []
    const translate = async ({ id, requestGate }) => {
      prepared++; peakPrepared = Math.max(peakPrepared, prepared)
      started.push(id)
      try {
        await Promise.all(['normal', 'correction'].map(() => requestGate(async () => {
          activeRequests++; peakRequests = Math.max(peakRequests, activeRequests)
          await new Promise(resolve => setTimeout(resolve, 3))
          activeRequests--; completedRequests++
        })))
        return { id, translation: { status: 'machine', coverage: { complete: 1, total: 1 } } }
      } finally { prepared-- }
    }
    const results = await translateLibrary({ dataDir: directory, concurrency: 2, report: value => logs.push(value), translate })
    const expected = ['pending-large', 'pending-medium', 'pending-mid-small', 'pending-small', 'done-large', 'done-small']
    assert.deepEqual(started, expected)
    assert.deepEqual(results.map(paper => paper.id), expected)
    assert.deepEqual(logs[0].papers, expected)
    assert.equal(peakPrepared, 4)
    assert.equal(peakRequests, 2)
    assert.equal(completedRequests, 12)
    assert.equal(logs.at(-1).completedPapers, 6)
    assert.equal(logs.at(-1).requests.peak, 2)
    assert.deepEqual(await readFile(catalogFile), before)

    started.length = 0
    const explicit = ['done-small', 'pending-large']
    const selected = await translateLibrary({ dataDir: directory, ids: explicit, concurrency: 2, report: () => {}, translate })
    assert.deepEqual(started, explicit)
    assert.deepEqual(selected.map(paper => paper.id), explicit)
    assert.deepEqual(await readFile(catalogFile), before)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
