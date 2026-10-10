import assert from 'node:assert/strict'
import test from 'node:test'
import { benchmarkLMStudio, parseArguments, syntheticParagraph, validateTranslation } from './benchmark-lm-studio.mjs'

const inventory = url => url.endsWith('/api/v1/models')
  ? { models: [{ loaded_instances: [{ id: 'qwen3.8-27b-splash' }] }] }
  : { data: [{ id: 'qwen3.8-27b-splash' }] }
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('benchmark options enforce small local bounds and preserve serial-first order', () => {
  assert.deepEqual(parseArguments(['--concurrency', '2,1,2', '--iterations', '4']).concurrency, [1, 2])
  assert.throws(() => parseArguments(['--concurrency', '5']), /range/)
  assert.throws(() => parseArguments(['--iterations', '100']), /range/)
  assert.throws(() => parseArguments(['--timeout-ms', '999999']), /range/)
  assert.equal(parseArguments([]).format, 'schema')
  assert.equal(parseArguments(['--format', 'prompt-json']).format, 'prompt-json')
  assert.throws(() => parseArguments(['--format', 'other']), /Unknown/)
})

test('mock benchmark uses the same four jobs, measures usage and limits concurrency without logging source', async () => {
  let active = 0
  let peak = 0
  const requests = []
  const logs = []
  const runs = await benchmarkLMStudio({ iterations: 4, concurrency: [1, 2, 4], report: value => logs.push(value), fetcher: async (url, options) => {
    if (url.endsWith('/models')) return response(inventory(url))
    const body = JSON.parse(options.body)
    requests.push(body)
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    const record = JSON.parse(body.messages[1].content).records[0]
    const index = Number(record.id.split('-')[1]) - 1
    return response({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: {
      [record.id]: `这是用于性能测试的中文译文。实验 ${index + 1} 的容量为 ${128 + index * 16}，运行 2 个请求。`,
    } }) } }], usage: { prompt_tokens: 200, completion_tokens: 250, total_tokens: 450 } })
  } })
  assert.equal(peak, 4)
  assert.equal(requests.length, 12)
  assert.deepEqual(requests.slice(0, 4), requests.slice(4, 8))
  assert.deepEqual(requests.slice(0, 4), requests.slice(8))
  assert.deepEqual(runs.map(run => [run.concurrency, run.jobs, run.completionTokens]), [[1, 4, 1000], [2, 4, 1000], [4, 4, 1000]])
  assert.ok(runs.every(run => run.aggregateCompletionTokensPerSecond > 0 && run.wallSeconds > 0))
  assert.ok(runs.every(run => run.validatedJobsPerSecond > 0 && run.p50RequestSeconds <= run.p95RequestSeconds && run.qualityFailures === 0))
  assert.ok(runs.every(run => run.reasoningTokens === null))
  assert.ok(requests.every(body => body.max_tokens === 512 && body.reasoning_effort === 'none' && body.stream === false))
  assert.ok(requests.every(body => body.response_format.type === 'json_schema' && body.response_format.json_schema.strict === true))
  assert.ok(!JSON.stringify(logs).includes(syntheticParagraph(0)))
  assert.ok(!JSON.stringify(logs).includes('这是用于性能测试'))
})

test('structured quality validation rejects changed IDs, numbers, malformed JSON and truncation', () => {
  const output = content => ({ model: 'qwen3.8-27b-splash', choices: [{ finish_reason: 'stop', message: { content } }] })
  assert.throws(() => validateTranslation(output('{"translations":{"wrong":"实验 1，容量 128，并发 2"}}'), 0), /paragraph ID/)
  assert.throws(() => validateTranslation(output('{"translations":{"paragraph-1":"实验 1，容量 129，并发 2"}}'), 0), /numeric constants/)
  assert.throws(() => validateTranslation(output('no JSON'), 0), /structured JSON/)
  const truncated = output('{"translations":{"paragraph-1":"实验 1，容量 128，并发 2"}}')
  truncated.choices[0].finish_reason = 'length'
  assert.throws(() => validateTranslation(truncated, 0), /truncated/)
})

test('accepts only optional complete outer JSON fences and reports envelopes without response text', async () => {
  const plain = '{"translations":{"paragraph-1":"实验 1，容量 128，并发 2。"}}'
  const output = content => ({ model: 'qwen3.8-27b-splash', choices: [{ finish_reason: 'stop', message: { content } }] })
  assert.deepEqual(validateTranslation(output(plain), 0), { responseEnvelope: 'plain-json', responseChannel: 'content' })
  assert.deepEqual(validateTranslation(output(`  \n\`\`\`json\n${plain}\n\`\`\`\n`), 0), { responseEnvelope: 'fenced-json', responseChannel: 'content' })
  assert.deepEqual(validateTranslation(output(`\`\`\`\n${plain}\n\`\`\``), 0), { responseEnvelope: 'fenced-json', responseChannel: 'content' })
  for (const invalid of [`Explanation\n${plain}`, `\`\`\`json\n${plain}\n\`\`\`\nExplanation`, `\`\`\`javascript\n${plain}\n\`\`\``, '\`\`\`json\nnot JSON\n\`\`\`']) {
    assert.throws(() => validateTranslation(output(invalid), 0), /structured JSON/)
  }
  assert.throws(() => validateTranslation(output(`\`\`\`json\n${plain.replace('128', '129')}\n\`\`\``), 0), /numeric constants/)
  const logs = []
  const [run] = await benchmarkLMStudio({ format: 'prompt-json', iterations: 1, concurrency: [2], report: value => logs.push(value), fetcher: async url => {
    if (url.endsWith('/models')) return response(inventory(url))
    return response({ ...output(`\`\`\`json\n${plain}\n\`\`\``), usage: { prompt_tokens: 200, completion_tokens: 250, total_tokens: 450 } })
  } })
  assert.equal(run.responseEnvelope, 'fenced-json')
  assert.deepEqual(run.responseEnvelopeCounts, { 'fenced-json': 1 })
  assert.ok(!JSON.stringify(logs).includes('实验'))
})

test('prompt JSON changes only the schema request field and keeps identical acceptance guards', async () => {
  const bodies = []
  const fetcher = async (url, options) => {
    if (url.endsWith('/models')) return response(inventory(url))
    const body = JSON.parse(options.body)
    bodies.push(body)
    return response({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: '{"translations":{"paragraph-1":"实验 1，容量 128，并发 2。"}}' } }],
      usage: { prompt_tokens: 200, completion_tokens: 250, total_tokens: 450 } })
  }
  for (const format of ['schema', 'prompt-json']) {
    const [run] = await benchmarkLMStudio({ format, iterations: 1, concurrency: [2], fetcher, report: () => {} })
    assert.equal(run.responseFormat, format)
    assert.equal(run.validatedJobs, 1)
    assert.equal(run.qualityFailures, 0)
  }
  const { response_format, ...schemaBody } = bodies[0]
  assert.equal(response_format.type, 'json_schema')
  assert.deepEqual(schemaBody, bodies[1])
  assert.ok(!Object.hasOwn(bodies[1], 'response_format'))
  for (const format of ['schema', 'prompt-json']) {
    await assert.rejects(benchmarkLMStudio({ format, iterations: 1, concurrency: [2], report: () => {}, fetcher: async url => {
      if (url.endsWith('/models')) return response(inventory(url))
      return response({ model: 'qwen3.8-27b-splash', choices: [{ finish_reason: 'stop', message: { content: '{"translations":{"paragraph-1":"实验 1，容量 129，并发 2。"}}' } }],
        usage: { prompt_tokens: 200, completion_tokens: 250, total_tokens: 450 } })
    } }), /numeric constants/)
  }
})

test('errors abort the active queue and prevent later configurations or retries', async () => {
  let completions = 0
  await assert.rejects(benchmarkLMStudio({ concurrency: [2, 3], iterations: 4, report: () => {}, fetcher: async (url, options) => {
    if (url.endsWith('/models')) return response(inventory(url))
    completions++
    if (completions === 1) return new Response('unprinted server diagnostics', { status: 500 })
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  } }), /HTTP 500/)
  assert.equal(completions, 2)
})

test('refuses remote endpoints, model substitution, and unloaded models before inference', async () => {
  const neverFetch = async () => { throw new Error('should not contact API') }
  await assert.rejects(benchmarkLMStudio({ endpoint: 'https://remote.example/v1', fetcher: neverFetch }), /loopback/)
  await assert.rejects(benchmarkLMStudio({ model: 'another-qwen', fetcher: neverFetch }), /exact configured/)
  let completions = 0
  await assert.rejects(benchmarkLMStudio({ fetcher: async url => {
    if (!url.endsWith('/models')) completions++
    return response(url.endsWith('/api/v1/models') ? { models: [] } : inventory(url))
  }, report: () => {} }), /already be loaded/)
  assert.equal(completions, 0)
})

test('explicitly selected authorized MoE model requires matching inventories and response identity', async () => {
  const model = 'qwen3.6-35b-a3b'
  let returnedModel = model
  let loaded = true
  let completions = 0
  const fetcher = async (url, options) => {
    if (url.endsWith('/api/v1/models')) return response({ models: [{ loaded_instances: loaded ? [{ id: model }] : [] }] })
    if (url.endsWith('/models')) return response({ data: [{ id: model }] })
    completions++
    assert.equal(JSON.parse(options.body).model, model)
    return response({ model: returnedModel, choices: [{ finish_reason: 'stop', message: { content: '{"translations":{"paragraph-1":"实验 1，容量 128，并发 2。"}}' } }],
      usage: { prompt_tokens: 200, completion_tokens: 250, total_tokens: 450 } })
  }
  const options = { model, fetcher, iterations: 1, concurrency: [1], report: () => {} }
  const [run] = await benchmarkLMStudio(options)
  assert.deepEqual(run.actualModelIds, [model])
  returnedModel = 'qwen3.8-27b-splash'
  await assert.rejects(benchmarkLMStudio(options), /response model/)
  loaded = false
  await assert.rejects(benchmarkLMStudio(options), /already be loaded/)
  assert.equal(completions, 2)
})

test('MoE routed JSON keeps identical numeric validation and records the actual response channel', () => {
  const model = 'qwen3.6-35b-a3b'
  const output = value => ({ model, choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: value } }] })
  const json = '{"translations":{"paragraph-1":"实验 1，容量 128，并发 2。"}}'
  assert.deepEqual(validateTranslation(output(json), 0, model), { responseEnvelope: 'plain-json', responseChannel: 'reasoning_content' })
  assert.throws(() => validateTranslation(output(json.replace('128', '129')), 0, model), /numeric constants/)
  assert.throws(() => validateTranslation(output(`Let me think. ${json}`), 0, model), /entire plain/)
})
