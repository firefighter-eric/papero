import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { safeId } from './paper-lib.mjs'
import { translatePaper } from './translate-paper.mjs'

export function concurrencyLimit(value) {
  if (!/^[1-4]$/.test(String(value))) throw new Error('Translation concurrency must be an integer from 1 to 4')
  return Number(value)
}

/** One FIFO gate shared by every paper, batch, correction and retry. */
export function createRequestGate(limit) {
  limit = concurrencyLimit(limit)
  let active = 0
  let peak = 0
  let completed = 0
  let stopped
  const queued = []
  const dispatch = () => {
    while (!stopped && active < limit && queued.length) {
      const { action, resolve, reject } = queued.shift()
      active++
      peak = Math.max(peak, active)
      Promise.resolve().then(action).then(value => { completed++; resolve(value) }, reject).finally(() => {
        active--
        dispatch()
      })
    }
  }
  const gate = action => new Promise((resolve, reject) => {
    if (stopped) { reject(stopped); return }
    queued.push({ action, resolve, reject })
    dispatch()
  })
  gate.stop = error => {
    stopped ||= error
    while (queued.length) queued.shift().reject(stopped)
  }
  gate.stats = () => ({ limit, active, queued: queued.length, peak, completed })
  return gate
}

export async function translateLibrary({ dataDir = process.env.DATA_DIR || 'data', ids = [], concurrency = 2,
  translate = translatePaper, report = value => console.log(JSON.stringify(value)),
  handleSignals = false, signalEmitter = process, ...options } = {}) {
  concurrency = concurrencyLimit(concurrency)
  const catalog = JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8'))
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.papers)) throw new Error('Invalid local paper catalog')
  const catalogIds = catalog.papers.map(paper => paper.id)
  if (catalogIds.some(id => !safeId(id)) || new Set(catalogIds).size !== catalogIds.length) throw new Error('Catalog has invalid or duplicate paper IDs')
  if (ids.some(id => !safeId(id) || !catalogIds.includes(id)) || new Set(ids).size !== ids.length) throw new Error('Selected paper IDs are invalid, duplicated or absent from the catalog')
  // Prepare at most four documents at once. Start larger pending documents
  // first so one long article does not become a serial tail of the queue.
  const selected = ids.length ? ids : [...catalog.papers].sort((a, b) =>
    Number(b.translationStatus === 'pending') - Number(a.translationStatus === 'pending')
      || (b.blockCount || 0) - (a.blockCount || 0)).map(paper => paper.id)
  const requestGate = createRequestGate(concurrency)
  const started = Date.now()
  report({ type: 'library-translation-start', papers: selected, concurrency, reasoningEffort: 'none' })
  let firstFailure
  const signalHandlers = new Map()
  if (handleSignals) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        if (firstFailure) return
        firstFailure = Object.assign(new Error(`Translation interrupted by ${signal}; accepted requests will checkpoint before exit`), { signal })
        requestGate.stop(firstFailure)
        report({ type: 'library-translation-draining', signal, requests: requestGate.stats() })
      }
      signalHandlers.set(signal, handler)
      signalEmitter.on(signal, handler)
    }
  }
  const results = new Array(selected.length)
  let nextPaper = 0
  const processPaper = async id => {
    try {
      const paper = await translate({ ...options, id, dataDir, concurrency, requestGate })
      report({ type: 'paper-translation-complete', id, coverage: paper.translation.coverage, status: paper.translation.status })
      return { status: 'fulfilled', value: paper }
    } catch (error) {
      if (!firstFailure) {
        firstFailure = error
        requestGate.stop(error)
      }
      report({ type: 'paper-translation-stopped', id, message: error.message })
      return { status: 'rejected', reason: error }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (!firstFailure && nextPaper < selected.length) {
        const index = nextPaper++
        results[index] = await processPaper(selected[index])
      }
    }))
  } finally {
    for (const [signal, handler] of signalHandlers) signalEmitter.off(signal, handler)
  }
  report({ type: 'library-translation-finished', completedPapers: results.filter(result => result?.status === 'fulfilled').length,
    totalPapers: selected.length, elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(3)), requests: requestGate.stats() })
  if (firstFailure) throw firstFailure
  return results.map(result => result.value)
}

export function parseLibraryArguments(args) {
  const options = { ids: [], concurrency: 2, help: false }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help') options.help = true
    else if (argument === '--concurrency') options.concurrency = concurrencyLimit(args[++index])
    else if (argument === '--batch-characters') {
      const value = args[++index]
      if (!/^\d+$/.test(value || '') || Number(value) < 256 || Number(value) > 6000) throw new Error('--batch-characters must be an integer from 256 to 6000')
      options.batchCharacters = Number(value)
    }
    else if (argument === '--allow-model-change') options.allowModelChange = true
    else if (argument === '--model') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('--model requires an exact local API model identifier')
      options.model = value
    }
    else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}`)
    else options.ids.push(argument)
  }
  return options
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const options = parseLibraryArguments(process.argv.slice(2))
    if (options.help) console.log('Usage: npm run library:translate -- [paper-id ...] [--concurrency 1..4] [--batch-characters 256..6000] [--model exact-api-id] [--allow-model-change]\nDefault: all locally registered papers, 2 concurrent local API requests, batches of 6000 source characters. Completed blocks are reused. An explicit model change preserves prior per-block provenance. One global request limit includes corrections and retries; each paper has one writer. SIGINT/SIGTERM drain accepted requests before exit. No downloads or uploads.')
    else await translateLibrary({ ...options, handleSignals: true })
  } catch (error) {
    console.error(JSON.stringify({ type: 'library-translation-error', message: error.message }))
    process.exitCode = error.signal === 'SIGINT' ? 130 : error.signal === 'SIGTERM' ? 143 : 1
  }
}
