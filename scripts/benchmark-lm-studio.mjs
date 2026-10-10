import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { extractCompletionText } from './translation-workers.mjs'

const EXACT_MODEL = 'qwen3.8-27b-splash'
const AUTHORIZED_MODELS = new Set([EXACT_MODEL, 'qwen3.6-35b-a3b'])
const HELP = `Local LM Studio translation benchmark. Requires the exact configured model to be already loaded.

Usage: node --env-file-if-exists=.env scripts/benchmark-lm-studio.mjs [options]
  --concurrency 1,2,4 Concurrency configurations, integers 1–4 (default: 1,2,4)
  --iterations 4     Same total independent jobs per configuration, 1–12 (default: 4)
  --format schema    schema or prompt-json; both validate the same JSON and numbers (default: schema)
  --timeout-ms 90000 Per-request timeout, 1000–120000 ms (default: 90000)
  --help             Show this help without contacting LM Studio

Only synthetic local paragraphs are used. Output contains small JSON statistics, never source or responses.
No downloads, model loading, configuration changes, retries, or data/catalog writes are performed.
TTFT is not measured; this bounded benchmark uses non-streaming responses and API token usage.`

class BenchmarkError extends Error {
  constructor(message, category = 'runtime') { super(message); this.category = category }
}

function boundedInteger(value, min, max, label) {
  if (!/^\d+$/.test(String(value))) throw new BenchmarkError(`${label} must be an integer`)
  const number = Number(value)
  if (number < min || number > max) throw new BenchmarkError(`${label} is outside the supported range`)
  return number
}

export function parseArguments(args) {
  const options = { concurrency: [1, 2, 4], iterations: 4, timeoutMs: 90_000, format: 'schema', help: false }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help') { options.help = true; continue }
    const value = args[++index]
    if (argument === '--concurrency' && value) {
      options.concurrency = [...new Set(value.split(',').map(item => boundedInteger(item, 1, 4, 'Concurrency')))].sort((a, b) => a - b)
    } else if (argument === '--iterations' && value) options.iterations = boundedInteger(value, 1, 12, 'Iterations')
    else if (argument === '--timeout-ms' && value) options.timeoutMs = boundedInteger(value, 1_000, 120_000, 'Timeout')
    else if (argument === '--format' && ['schema', 'prompt-json'].includes(value)) options.format = value
    else throw new BenchmarkError('Unknown argument or missing option value; use --help')
  }
  return options
}

function localApiBase(endpoint) {
  let url
  try { url = new URL(endpoint) } catch { throw new BenchmarkError('LM Studio endpoint is not a valid local URL') }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) throw new BenchmarkError('Benchmark endpoint must be loopback HTTP(S), without credentials, query or fragment')
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`
  return url.href.replace(/\/$/, '')
}

/** Locally authored text, kept identical for a given job index across concurrency configurations. */
export function syntheticParagraph(index) {
  const capacity = 128 + index * 16
  return `A research reading application retrieves a small catalog before loading an individual document. `
    + `Each document has stable paragraph identifiers, a verified source fingerprint, and independent language fields. `
    + `The browser keeps mathematical expressions and executable code unchanged while translating explanatory prose. `
    + `Images are resolved relative to the document directory, and a cache validator prevents outdated metadata from being mixed with new content. `
    + `In experiment ${index + 1}, the local request queue has a capacity of ${capacity} items. `
    + `We measure completed output tokens and total elapsed time using the same collection of independent inputs. `
    + `Running 2 requests at once may improve aggregate throughput, but it can also increase the time experienced by one reader. `
    + `These measurements describe the configured machine and model; they do not establish translation quality or performance on another workload.`
}

const round = value => Number(value.toFixed(3))

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const low = Math.floor(position)
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low)
}

const paragraphId = index => `paragraph-${index + 1}`

function translationSchema(id) {
  return { type: 'json_schema', json_schema: { name: 'benchmark_translation', strict: true, schema: {
    type: 'object', properties: { translations: { type: 'object', properties: { [id]: { type: 'string' } }, required: [id], additionalProperties: false } },
    required: ['translations'], additionalProperties: false,
  } } }
}

export function validateTranslation(output, index, model = EXACT_MODEL) {
  let responseEnvelope
  const fail = message => {
    const error = new BenchmarkError(message, 'quality')
    if (responseEnvelope) error.responseEnvelope = responseEnvelope
    throw error
  }
  const choice = output.choices?.[0]
  if (choice?.finish_reason !== 'stop') fail('Completion was truncated or did not finish normally')
  if (output.model !== model) fail('Completion response model differs from the exact configured model')
  let extracted
  try { extracted = extractCompletionText(output, { expectedModel: model, expectedIds: [paragraphId(index)] }) }
  catch (error) { fail(error.message) }
  const content = extracted.content.trim()
  // Match only a complete outer JSON fence; prose, reasoning and other wrappers stay invalid.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(content)
  responseEnvelope = fenced ? 'fenced-json' : 'plain-json'
  let parsed
  try { parsed = JSON.parse(fenced ? fenced[1] : content) } catch { fail('Translation did not match the requested structured JSON format') }
  const id = paragraphId(index)
  if (!parsed || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !parsed.translations
    || Array.isArray(parsed.translations) || Object.keys(parsed.translations).length !== 1 || typeof parsed.translations[id] !== 'string') {
    fail('Translation JSON shape or expected paragraph ID is invalid')
  }
  const translated = parsed.translations[id]
  if (!/[\u3400-\u9fff]/.test(translated)) fail('Structured translation is not Chinese')
  const numbers = text => text.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g) || []
  const expected = numbers(syntheticParagraph(index)).toSorted()
  const actual = numbers(translated).toSorted()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('Translation changed, omitted, or added numeric constants')
  return { responseEnvelope, responseChannel: extracted.responseChannel }
}

async function jsonResponse(response, label) {
  if (!response.ok) throw new BenchmarkError(`${label} failed with HTTP ${response.status}`)
  try { return await response.json() } catch { throw new BenchmarkError(`${label} returned invalid JSON`) }
}

export async function benchmarkLMStudio({
  concurrency = [1, 2, 4], iterations = 4, timeoutMs = 90_000, format = 'schema',
  endpoint = process.env.LM_STUDIO_BASE_URL || process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1',
  model = process.env.LM_STUDIO_MODEL || EXACT_MODEL,
  fetcher = fetch, report = value => console.log(JSON.stringify(value)),
} = {}) {
  const limits = parseArguments(['--concurrency', concurrency.join(','), '--iterations', String(iterations), '--timeout-ms', String(timeoutMs), '--format', format])
  if (!AUTHORIZED_MODELS.has(model)) throw new BenchmarkError('Benchmark requires an exact configured, user-authorized model; no substitution is permitted')
  const apiBase = localApiBase(endpoint)
  const inventoryResponses = await Promise.allSettled([
    fetcher(`${apiBase}/models`, { credentials: 'omit', signal: AbortSignal.timeout(10_000) }).then(response => jsonResponse(response, 'API model inventory')),
    fetcher(`${apiBase.replace(/\/v1$/, '')}/api/v1/models`, { credentials: 'omit', signal: AbortSignal.timeout(10_000) }).then(response => jsonResponse(response, 'Loaded model inventory')),
  ])
  const failure = inventoryResponses.find(result => result.status === 'rejected')
  if (failure) throw failure.reason instanceof BenchmarkError ? failure.reason : new BenchmarkError('Local model inventory could not be read; benchmark stopped')
  const [available, native] = inventoryResponses.map(result => result.value)
  if (!available.data?.some(item => item.id === model)) throw new BenchmarkError('Exact configured model is not advertised by the local API')
  const nativeModel = native.models?.find(item => item.loaded_instances?.some(instance => instance.id === model))
  const loaded = nativeModel?.loaded_instances?.find(instance => instance.id === model)
  if (!loaded) throw new BenchmarkError('Exact configured model must already be loaded; benchmark will not load it')
  report({ type: 'benchmark-start', model, jobsPerConfiguration: limits.iterations, concurrency: limits.concurrency,
    runtimeContextLength: loaded.config?.context_length ?? null, runtimeParallel: loaded.config?.parallel ?? null,
    maxCompletionTokens: 512, temperature: 0.1, reasoningEffort: 'none', streaming: false, ttftMeasured: false,
    responseFormat: limits.format, validation: 'exact JSON shape, paragraph ID and numeric constants',
    workload: 'same locally authored medium technical paragraphs in each configuration',
    warmupRequests: 0, order: 'ascending concurrency; prior prompt-cache effects are possible' })

  const runs = []
  for (const parallelism of limits.concurrency) {
    const controller = new AbortController()
    const responses = new Array(limits.iterations)
    let nextJob = 0
    let firstError
    const start = performance.now()
    async function worker() {
      while (!controller.signal.aborted && nextJob < limits.iterations) {
        const index = nextJob++
        const requestStart = performance.now()
        try {
          const response = await fetcher(`${apiBase}/chat/completions`, {
            method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(limits.timeoutMs)]),
            body: JSON.stringify({ model, temperature: 0.1, top_p: 0.9, max_tokens: 512, seed: 42 + index, reasoning_effort: 'none', stream: false,
              ...(limits.format === 'schema' ? { response_format: translationSchema(paragraphId(index)) } : {}),
              messages: [{ role: 'system', content: 'Translate each complete technical paragraph into Simplified Chinese. Preserve every Arabic numeric constant exactly. Return only JSON with the original paragraph ID as its translations key. Do not add explanation. /no_think' },
                { role: 'user', content: JSON.stringify({ records: [{ id: paragraphId(index), text: syntheticParagraph(index) }] }) }] }),
          })
          const output = await jsonResponse(response, 'Completion request')
          const { responseEnvelope, responseChannel } = validateTranslation(output, index, model)
          const usage = output.usage
          if (![usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new BenchmarkError('Completion API did not provide valid token usage')
          }
          const optionalCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null
          responses[index] = { model: output.model, responseEnvelope, responseChannel, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
            reasoningTokens: optionalCount(usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens),
            cachedPromptTokens: optionalCount(usage.prompt_tokens_details?.cached_tokens),
            totalTokens: usage.total_tokens, elapsedSeconds: (performance.now() - requestStart) / 1000 }
        } catch (error) {
          if (!firstError) firstError = error instanceof BenchmarkError ? error : new BenchmarkError('Completion network error or timeout; remaining requests were cancelled')
          controller.abort()
          throw firstError
        }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(parallelism, limits.iterations) }, () => worker()))
    if (firstError) {
      report({ type: 'benchmark-run', status: 'failed', responseFormat: limits.format, concurrency: parallelism, requestedJobs: limits.iterations,
        validatedJobs: responses.filter(Boolean).length, qualityFailures: firstError.category === 'quality' ? 1 : 0,
        responseEnvelope: firstError.responseEnvelope ?? null,
        wallSeconds: round((performance.now() - start) / 1000), errorCategory: firstError.category })
      throw firstError
    }
    const wallSeconds = (performance.now() - start) / 1000
    const sum = key => responses.reduce((total, response) => total + response[key], 0)
    const optionalSum = key => responses.every(response => response[key] !== null) ? sum(key) : null
    const envelopes = [...new Set(responses.map(response => response.responseEnvelope))]
    const run = { type: 'benchmark-run', status: 'completed', responseFormat: limits.format, concurrency: parallelism, jobs: responses.length, validatedJobs: responses.length, qualityFailures: 0,
      responseEnvelope: envelopes.length === 1 ? envelopes[0] : 'mixed',
      responseEnvelopeCounts: Object.fromEntries(envelopes.map(envelope => [envelope, responses.filter(response => response.responseEnvelope === envelope).length])),
      responseChannelCounts: Object.fromEntries([...new Set(responses.map(response => response.responseChannel))].map(channel => [channel, responses.filter(response => response.responseChannel === channel).length])),
      actualModelIds: [...new Set(responses.map(response => response.model))],
      promptTokens: sum('promptTokens'), completionTokens: sum('completionTokens'), totalTokens: sum('totalTokens'),
      reasoningTokens: optionalSum('reasoningTokens'), cachedPromptTokens: optionalSum('cachedPromptTokens'),
      wallSeconds: round(wallSeconds), aggregateCompletionTokensPerSecond: round(sum('completionTokens') / wallSeconds),
      validatedJobsPerSecond: round(responses.length / wallSeconds),
      p50RequestSeconds: round(percentile(responses.map(response => response.elapsedSeconds), 0.5)),
      p95RequestSeconds: round(percentile(responses.map(response => response.elapsedSeconds), 0.95)),
      meanRequestSeconds: round(sum('elapsedSeconds') / responses.length),
      maxRequestSeconds: round(Math.max(...responses.map(response => response.elapsedSeconds))) }
    runs.push(run)
    report(run)
  }
  const serial = runs.find(run => run.concurrency === 1)
  report({ type: 'benchmark-summary', model, responseFormat: limits.format, runs: runs.length,
    comparison: runs.map(run => ({ concurrency: run.concurrency, aggregateCompletionTokensPerSecond: run.aggregateCompletionTokensPerSecond,
      throughputVsSerial: serial ? round(run.aggregateCompletionTokensPerSecond / serial.aggregateCompletionTokensPerSecond) : null })) })
  return runs
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log(HELP)
    else await benchmarkLMStudio(options)
  } catch (error) {
    console.error(JSON.stringify({ type: 'benchmark-error', message: error instanceof BenchmarkError ? error.message : 'Benchmark stopped after an unexpected error' }))
    process.exitCode = 1
  }
}
