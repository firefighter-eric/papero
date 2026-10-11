import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createRequestGate, runBoundedTasks, createSerialWriter, extractCompletionText, translationRequestBudget, protectSourceDelimiters, sourceNumericTokens } from './translation-workers.mjs'
import { parsePaper, sha256, technicalIdentifiers, assertTranslationFidelity } from './paper-lib.mjs'
import { translatePaper, assertCompletionResponse, translateWithSplitting, compactRequestContexts, parseUnitResponse } from './translate-paper.mjs'

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

test('numeric transport keeps scores and signs separate from immutable model versions', () => {
  const source = 'Phi-3 and GPT-3 score -3.5% and +10% on 9 tasks, with 15.6T tokens.'
  assert.deepEqual(technicalIdentifiers(source), ['Phi-3', 'GPT-3'])
  assert.deepEqual(sourceNumericTokens(source, technicalIdentifiers(source)), ['-3.5%', '+10%', '9', '15.6'])
  assert.deepEqual(sourceNumericTokens('Use 5-10 examples and 1e-3 steps.'), ['5', '10', '1e-3'])
  assert.deepEqual(sourceNumericTokens('Phi-3 and Phi-3', technicalIdentifiers('Phi-3 and Phi-3')), [])
  assertTranslationFidelity(' and Phi-3 ', '以及 Phi-3')
  assert.throws(() => assertTranslationFidelity(' and Phi-3 ', '以及 Phi-3 -3'), /added/)
  assert.throws(() => assertTranslationFidelity(' and Phi-3 ', '以及 Phi-2'), /identifier/)
  const comparison = 'Mistral-7B-v0.3 (63%) or Llama 3 8B (66%)'
  assert.deepEqual(technicalIdentifiers(comparison), ['Mistral-7B-v0.3', 'Llama 3'])
  assert.deepEqual(sourceNumericTokens(comparison, technicalIdentifiers(comparison)), ['63%', '8', '66%'])
  assertTranslationFidelity(comparison, 'Mistral-7B-v0.3（63%）或 Llama 3 8B（66%）')
  assert.throws(() => assertTranslationFidelity(comparison, 'Mistral-7B-v0.2（63%）或 Llama 3 8B（66%）'), /identifier/)
  assert.throws(() => assertTranslationFidelity(comparison, 'Mistral-7B-v0.3（63%）或 Llama 3 8B（66%），7B 参数'), /added/)
})

test('literal think delimiters use reversible per-unit transport and cannot cross units or lose multiplicity', () => {
  const records = [{ id: 'fragment:0', block: 'fragment', text: 'Finish with </think>. Preserve <think> and </think>.', mustPreserve: [] }, { id: 'fragment:1', block: 'fragment', text: 'Use <think> before the explanation.', mustPreserve: [] }]
  const contexts = [{ block: 'fragment', context: '⟦fragment:0⟧' + records[0].text + '⟦/fragment:0⟧ Other </think> context.' }]
  const original = structuredClone({ records, contexts }), transport = protectSourceDelimiters(records, contexts)
  assert.deepEqual({ records, contexts }, original)
  const payload = JSON.stringify({ records: transport.records, contexts: transport.contexts })
  assert.ok(!payload.includes('<think>') && !payload.includes('</think>'))
  const tokens = transport.records[0].text.match(/⟪PAPERO_LITERAL_[^⟫]*⟫/g)
  assert.equal(tokens.length, 3)
  const translated = `以 ${tokens[0]} 结束。保留 ${tokens[1]} 和 ${tokens[2]}。`
  const content = JSON.stringify({ translations: { 'fragment:0': translated } })
  const routed = extractCompletionText({ model: 'qwen3.6-35b-a3b', choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: content } }] }, { expectedModel: 'qwen3.6-35b-a3b', expectedIds: ['fragment:0'] })
  const [result] = parseUnitResponse(routed.content, [records[0]], { restoreValue: transport.restore })
  assert.equal(result.text, '以 </think> 结束。保留 <think> 和 </think>。')
  assert.throws(() => transport.restore('fragment:0', translated.replace(tokens[0], '')), /multiplicity/)
  assert.throws(() => transport.restore('fragment:0', translated + tokens[0]), /multiplicity/)
  assert.throws(() => transport.restore('fragment:1', tokens[1]), /moved/)
  assert.throws(() => transport.restore('fragment:0', tokens[1] + tokens[0] + tokens[2]), /order/)
  assert.throws(() => protectSourceDelimiters([{ id: 'a', text: 'Natural ⟪PAPERO_LITERAL_THINK_OPEN⟫ text' }]), /collides/)
  assert.throws(() => protectSourceDelimiters(records, [{ block: 'a', context: 'Natural ⟪PAPERO_LITERAL_ context' }]), /collides/)
})

test('evidenced ChatML delimiters in prose and context are masked and restored without changing protocol roles', () => {
  const records = [{ id: 'template', block: 'block', text: 'Use <|im_start|>user and <|im_end|>, then <|im_start|>assistant.' }]
  const transport = protectSourceDelimiters(records, [{ block: 'block', context: 'Example <|im_start|>user<|im_end|>' }])
  assert.ok(!JSON.stringify({ records: transport.records, contexts: transport.contexts }).includes('<|im_'))
  const tokens = transport.records[0].text.match(/⟪PAPERO_LITERAL_[^⟫]*⟫/g)
  const response = JSON.stringify({ translations: { template: `使用 ${tokens[0]}user 和 ${tokens[1]}，然后使用 ${tokens[2]}assistant。` } })
  const [result] = parseUnitResponse(response, records, { restoreValue: transport.restore })
  assert.equal(result.text, '使用 <|im_start|>user 和 <|im_end|>，然后使用 <|im_start|>assistant。')
  assert.throws(() => parseUnitResponse(response.replace('user', '用户'), records, { restoreValue: transport.restore }), /protocol role/)
  assert.throws(() => parseUnitResponse(response.replace(tokens[1], tokens[0]), records, { restoreValue: transport.restore }), /order|multiplicity/)
})

test('verified 8K context reduces request budgets while larger and unknown contexts keep the original limits', () => {
  const small = translationRequestBudget(8192, 6000)
  assert.deepEqual([small.maxTokens, small.maximumRecords, small.maximumCharacters, small.maximumContextCharacters], [4096, 40, 3000, 1200])
  assert.equal(translationRequestBudget(8192, 2000).maximumCharacters, 2000)
  for (const context of [8193, 16384, undefined, 0, -1, 8192.5]) {
    const budget = translationRequestBudget(context)
    assert.deepEqual([budget.maxTokens, budget.maximumRecords, budget.maximumCharacters, budget.maximumContextCharacters], [7000, 80, 6000, 4000])
  }
  assert.throws(() => translationRequestBudget(8192, 0), /positive integer/)
})

test('small-context chunks obey source and record budgets without losing a single long scientific text node', async () => {
  const records = Array.from({ length: 85 }, (_, index) => ({ id: 'unit-' + index, text: 'x'.repeat(100), block: 'list' }))
  records.splice(42, 0, { id: 'long', text: 'y'.repeat(5214), block: 'paragraph' })
  const budget = translationRequestBudget(8192, 3000), requests = []
  const results = await translateWithSplitting(records, async chunk => {
    requests.push(chunk)
    return chunk.map(record => ({ id: record.id, text: '译文' }))
  }, { ...budget, concurrency: 2 })
  assert.deepEqual(results.map(result => result.id), records.map(record => record.id))
  assert.ok(requests.every(chunk => chunk.length <= 40))
  assert.ok(requests.every(chunk => chunk.reduce((n, record) => n + record.text.length, 0) <= 3000 || (chunk.length === 1 && chunk[0].id === 'long')))
  assert.equal(requests.find(chunk => chunk[0].id === 'long').length, 1)
  let oversizedWasSent = false
  await assert.rejects(() => translateWithSplitting([{ id: 'oversized', text: 'x'.repeat(6001) }], async () => { oversizedWasSent = true }, { ...budget }), /exceeds 6000/)
  assert.equal(oversizedWasSent, false)
  const contexts = [{ block: 'list', context: 'prefix '.repeat(1000) + '⟦unit-0⟧ text' }, { block: 'paragraph', context: 'prefix '.repeat(1000) + '⟦long⟧ text' }]
  assert.ok(compactRequestContexts(contexts, [records[0], records[42]], { maximumCharacters: budget.maximumContextCharacters }).reduce((n, item) => n + item.context.length, 0) <= 1200)
  assert.ok(compactRequestContexts(contexts, [records[42]], { maximumCharacters: budget.maximumSingleLongUnitContext }).reduce((n, item) => n + item.context.length, 0) <= 300)
})

test('the exact MoE routing workaround accepts only a complete known-ID translation JSON document', () => {
  const options = { expectedModel: 'qwen3.6-35b-a3b', expectedIds: ['block:0', 'block:1'] }
  const text = '{"translations":{"block:0":"模型得分91.2%。","block:1":"保留字符串 \\"translations\\" 和 {花括号}。"}}'
  const response = reasoning => ({ model: options.expectedModel, choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: reasoning } }] })
  assert.deepEqual(extractCompletionText(response(text), options), { content: text, responseChannel: 'reasoning_content' })
  const normal = response('I should think carefully before answering.')
  normal.choices[0].message.content = text
  assert.deepEqual(extractCompletionText(normal, options), { content: text, responseChannel: 'content' })
  for (const rejected of [
    'I will translate the text. ' + text,
    '<think>Reasoning goes here.</think>' + text,
    '```json\n' + text + '\n```',
    '{"translations":{"block:0":"译文","extra":"额外"}}',
    '{"translations":{"block:0":"译文"}}',
    '{"translations":{"block:0":"译文","block:1":17}}',
    '{"translations":{"block:0":"译文","block:1":""}}',
    '{"translations":{"block:0":"译文","block:1":"译文"},"reasoning":"explanation"}',
    '{"translations":{"block:0":"初稿","block:0":"改稿","block:1":"译文"}}',
    '{"translations":{"block:0":"初稿","block\\u003a0":"改稿","block:1":"译文"}}',
  ]) assert.throws(() => extractCompletionText(response(rejected), options))
  const otherModel = response(text); otherModel.model = 'qwen3.8-27b-splash'
  assert.throws(() => extractCompletionText(otherModel, { ...options, expectedModel: otherModel.model }), /no final content/)
  assert.throws(() => extractCompletionText(otherModel, options), /model mismatch/)
  const truncated = response(text); truncated.choices[0].finish_reason = 'length'
  assert.throws(() => extractCompletionText(truncated, options), /truncated/)
  const tools = response(text); tools.choices[0].message.tool_calls = [{ id: 'call', type: 'function' }]
  assert.throws(() => extractCompletionText(tools, options), /tool calls/)
  const whitespace = response(text); whitespace.choices[0].message.content = ' '
  assert.throws(() => extractCompletionText(whitespace, options), /no final content/)
})

test('one shared request gate bounds normal, correction and retry work across workers', async () => {
  const gate = createRequestGate(2)
  let active = 0, maximum = 0
  const result = await Promise.all(Array.from({ length: 12 }, (_, index) => gate(async () => {
    active++; maximum = Math.max(maximum, active)
    await pause(5 + index % 3)
    active--
    return index
  })))
  assert.equal(maximum, 2)
  assert.deepEqual(result, Array.from({ length: 12 }, (_, index) => index))
  await assert.rejects(gate(async () => { throw new Error('failed request') }), /failed request/)
  assert.equal(await gate(async () => 'next request'), 'next request')
})

test('routed MoE JSON still passes fidelity corrections and records actual reasoning usage and channels', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-routed-paper-'))
  const model = 'qwen3.6-35b-a3b'
  let requests = 0, corrections = 0
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: model }] })); return }
    if (request.url === '/api/v1/models') { response.end(JSON.stringify({ models: [{ key: model, loaded_instances: [{ id: model, config: { context_length: 8192 } }] }] })); return }
    let body = ''; for await (const chunk of request) body += chunk
    const payload = JSON.parse(body), input = JSON.parse(payload.messages[1].content)
    assert.equal(payload.max_tokens, 4096)
    assert.ok(input.records.length <= 40)
    assert.ok(input.contexts.reduce((n, item) => n + item.context.length, 0) <= 1200)
    assert.ok(!JSON.stringify(input).includes('<think>') && !JSON.stringify(input).includes('</think>'))
    const isolated = payload.messages[0].content.startsWith('Translate each exact English fragment')
    requests++; if (isolated) corrections++
    const translations = Object.fromEntries(input.records.map(record => {
      const tokens = record.text.match(/⟪PAPERO_LITERAL_[^⟫]*⟫/g)
      return [record.id, record.text === 'Fixture paper' ? '示例论文' : tokens ? `以 ${tokens[0]} 和 ${tokens[1]} 结束思考，再回复。` : isolated ? 'Qwen2-72B 模型得分91.2%。' : 'Qwen2-72B 模型得分99.9%。']
    }))
    response.end(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: JSON.stringify({ translations }) } }], usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 17 } } }))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const id = 'routing-fixture'
    const paper = parsePaper('<article class="ltx_document"><h1 class="ltx_title_document">Fixture paper</h1><p>The Qwen2-72B model scores 91.2%.</p><p>Finish with &lt;think&gt; and &lt;/think&gt;, then reply.</p></article>', { id, arxivId: '1706.03762v7' })
    const paperDirectory = path.join(directory, 'papers', id)
    await mkdir(paperDirectory, { recursive: true }); await writeFile(path.join(paperDirectory, 'paper.json'), JSON.stringify(paper))
    const completed = await translatePaper({ id, dataDir: directory, model, endpoint: `http://127.0.0.1:${server.address().port}/v1` })
    assert.equal(corrections, 1)
    assert.equal(completed.translation.status, 'machine')
    assert.ok(completed.blocks[0].zh.includes('91.2'))
    assert.ok(!completed.blocks[0].zh.includes('99.9'))
    assert.deepEqual(completed.blocks[0].translation.responseChannels, ['reasoning_content'])
    assert.equal(completed.translation.parameters.max_tokens, 4096)
    assert.equal(completed.translation.modelHistory.at(-1).parameters.max_tokens, 4096)
    assert.deepEqual(completed.blocks[0].translation.requestBudget, completed.translation.modelHistory.at(-1).requestBudget)
    assert.equal(completed.blocks[1].en, paper.blocks[1].en)
    assert.ok(completed.blocks[1].zh.includes('&lt;think&gt;') && completed.blocks[1].zh.includes('&lt;/think&gt;'))
    assert.ok(!completed.blocks[1].zh.includes('PAPERO_LITERAL'))
    assert.equal(completed.blocks[1].translation.literalTransport, 'opaque-model-delimiters-v2')
    assert.equal(completed.translation.usage.observedReasoningTokens, 17 * requests)
    assert.equal(completed.translation.usage.reasoningUsageResponses, requests)
    const files = (await readdir(paperDirectory)).filter(filename => filename.startsWith('translation-response-'))
    for (const filename of files) {
      const log = JSON.parse(await readFile(path.join(paperDirectory, filename), 'utf8'))
      assert.equal(log.responseChannel, 'reasoning_content')
      assert.equal(log.usage.completion_tokens_details.reasoning_tokens, 17)
    }
  } finally {
    await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true })
  }
})

test('fatal failure stops new dispatch and awaits accepted in-flight checkpoints', async () => {
  const started = [], checkpoints = []
  const write = createSerialWriter()
  await assert.rejects(runBoundedTasks(['fatal', 'accepted', 'never-dispatched'], async item => {
    started.push(item)
    if (item === 'fatal') { await pause(5); throw new Error('fatal validation') }
    await pause(20)
    await write(async () => { await pause(5); checkpoints.push(item) })
  }, { concurrency: 2 }), /fatal validation/)
  assert.deepEqual(started, ['fatal', 'accepted'])
  assert.deepEqual(checkpoints, ['accepted'])
})

test('checkpoint writer serializes snapshots even when batches finish out of order', async () => {
  const write = createSerialWriter()
  let active = 0, maximum = 0
  const order = []
  const release = new Map()
  const enqueued = new Map()
  const notifications = new Map()
  const operations = [3, 1, 2].map(async value => {
    const ready = new Promise(resolve => { enqueued.set(value, resolve) })
    notifications.set(value, ready)
    await new Promise(resolve => { release.set(value, resolve) })
    enqueued.get(value)()
    return write(async () => {
      active++; maximum = Math.max(maximum, active)
      await pause(5)
      order.push(value); active--
    })
  })
  for (const value of [1, 2, 3]) { release.get(value)(); await notifications.get(value) }
  await Promise.all(operations)
  assert.equal(maximum, 1)
  assert.deepEqual(order, [1, 2, 3])
})

test('parallel paper batches use the shared gate for isolated retries and preserve complete data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-parallel-paper-'))
  let active = 0, maximum = 0, requests = 0, isolatedAttempts = 0, rejectedNormal = false
  const observedInstructions = []
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'fixture-fast' }] })); return }
    if (request.url === '/api/v1/models') { response.end(JSON.stringify({ models: [] })); return }
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body), input = JSON.parse(payload.messages[1].content)
    observedInstructions.push(input.correctionInstructions)
    active++; maximum = Math.max(maximum, active); requests++
    const isolated = payload.messages[0].content.startsWith('Translate each exact English fragment')
    if (isolated) isolatedAttempts++
    await pause(8 + requests % 3)
    const translations = Object.fromEntries(input.records.map(record => {
      if (record.text === 'Fixture paper') return [record.id, '示例论文']
      if (record.text === 'Results') return [record.id, '结果']
      if (!isolated && !rejectedNormal) { rejectedNormal = true; return [record.id, '模型得分91.2%。'] }
      if (isolated && isolatedAttempts === 1) return [record.id, '模型得分91.2%。']
      return [record.id, 'Qwen2-72B 模型得分91.2%。']
    }))
    active--
    response.end(JSON.stringify({ model: payload.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 } } }))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const id = 'parallel-fixture'
    const html = '<article class="ltx_document"><h1 class="ltx_title_document">Fixture paper</h1><section id="S1"><h2>Results</h2>' + '<p>The Qwen2-72B model scores 91.2%.</p>'.repeat(8) + '</section></article>'
    const paper = parsePaper(html, { id, arxivId: '1706.03762v7' })
    const paperDirectory = path.join(directory, 'papers', id)
    await mkdir(paperDirectory, { recursive: true })
    await writeFile(path.join(paperDirectory, 'paper.json'), JSON.stringify(paper))
    const completed = await translatePaper({ id, dataDir: directory, model: 'fixture-model', endpoint: `http://127.0.0.1:${server.address().port}/v1`, concurrency: 4, requestGate: createRequestGate(2), batchCharacters: 40 })
    assert.equal(maximum, 2)
    assert.equal(isolatedAttempts, 2)
    assert.equal(completed.translation.coverage.complete, completed.blocks.length)
    assert.equal(completed.translation.status, 'machine')
    assert.equal(completed.translation.usage.reasoningUsageResponses, requests)
    assert.equal(completed.translation.usage.observedReasoningTokens, 0)
    const saved = JSON.parse(await readFile(path.join(paperDirectory, 'paper.json'), 'utf8'))
    const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'))
    assert.equal(catalog.papers[0].translationStatus, saved.translation.status)
    assert.equal(catalog.papers[0].titleZh, saved.titleZh)
    assert.equal((await readdir(paperDirectory)).filter(filename => filename.startsWith('translation-response-')).length, requests)
    assert.ok(saved.blocks.some(block => block.translation?.corrections?.method === 'isolated-fragment-retranslation'))
    assert.ok(observedInstructions.every(value => value === undefined))
    const selected = completed.blocks.find(block => block.kind === 'paragraph')
    const otherBlocks = completed.blocks.filter(block => block.id !== selected.id).map(block => block.zh)
    rejectedNormal = false; isolatedAttempts = 0; observedInstructions.length = 0
    const correctionInstructions = 'Retain the entire model comparison before its immutable citation.'
    const corrected = await translatePaper({ id, dataDir: directory, model: 'fixture-model', endpoint: `http://127.0.0.1:${server.address().port}/v1`, retranslateSourceIds: [selected.sourceId], correctionInstructions })
    assert.equal(isolatedAttempts, 2)
    assert.ok(observedInstructions.every(value => value === correctionInstructions))
    assert.equal(corrected.translation.corrections.at(-1).instructionsSha256, sha256(correctionInstructions))
    assert.equal(corrected.blocks.find(block => block.id === selected.id).translation.reviewCorrection.instructionsSha256, sha256(correctionInstructions))
    assert.deepEqual(corrected.blocks.filter(block => block.id !== selected.id).map(block => block.zh), otherBlocks)
    await assert.rejects(() => translatePaper({ id, dataDir: directory, correctionInstructions: 'Unscoped hint' }), /require explicit/)
    const beforeRefusal = await readFile(path.join(paperDirectory, 'paper.json'), 'utf8')
    await assert.rejects(() => translatePaper({ id, dataDir: directory, model: 'fixture-fast', endpoint: `http://127.0.0.1:${server.address().port}/v1`, retranslateSourceIds: [selected.sourceId] }), /allow-model-change/)
    assert.equal(await readFile(path.join(paperDirectory, 'paper.json'), 'utf8'), beforeRefusal)
    const mixed = await translatePaper({ id, dataDir: directory, model: 'fixture-fast', allowModelChange: true, endpoint: `http://127.0.0.1:${server.address().port}/v1`, retranslateSourceIds: [selected.sourceId] })
    assert.equal(mixed.translation.model, 'fixture-fast')
    assert.deepEqual(mixed.translation.modelsUsed, ['fixture-model', 'fixture-fast'])
    assert.equal(mixed.blocks.find(block => block.id === selected.id).translation.model, 'fixture-fast')
    assert.ok(mixed.blocks.filter(block => block.id !== selected.id && block.translation.model).every(block => block.translation.model === 'fixture-model' && block.translation.modelIdentity.apiModelId === 'fixture-model'))
    assert.equal(mixed.translation.modelHistory.at(-1).reason, 'explicit-model-change')
    assert.equal(mixed.translation.usage.promptTokens, Object.values(mixed.translation.usageByModel).reduce((sum, value) => sum + value.promptTokens, 0))
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('accepted blocks cannot mark a checkpoint complete while its title translation fails', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-title-checkpoint-'))
  let releaseTitle
  const titleHeld = new Promise(resolve => { releaseTitle = resolve })
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return }
    if (request.url === '/api/v1/models') { response.end(JSON.stringify({ models: [] })); return }
    let body = ''; for await (const chunk of request) body += chunk
    const input = JSON.parse(JSON.parse(body).messages[1].content)
    const isTitle = input.records.some(record => record.id.startsWith('__title'))
    if (isTitle) await titleHeld
    const translations = Object.fromEntries(input.records.map(record => [record.id, 'Qwen2-72B 模型得分91.2%。']))
    response.end(JSON.stringify({ model: isTitle ? 'wrong-model' : 'fixture-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations }) } }] }))
  })
  let running
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const id = 'title-fixture'
    const paper = parsePaper('<article class="ltx_document"><h1 class="ltx_title_document">Fixture paper</h1><p>The Qwen2-72B model scores 91.2%.</p></article>', { id, arxivId: '1706.03762v7' })
    const paperDirectory = path.join(directory, 'papers', id)
    await mkdir(paperDirectory, { recursive: true }); await writeFile(path.join(paperDirectory, 'paper.json'), JSON.stringify(paper))
    running = translatePaper({ id, dataDir: directory, model: 'fixture-model', endpoint: `http://127.0.0.1:${server.address().port}/v1`, concurrency: 2, batchCharacters: 1 })
    let checkpoint
    for (let attempt = 0; attempt < 100; attempt++) {
      checkpoint = JSON.parse(await readFile(path.join(paperDirectory, 'paper.json'), 'utf8'))
      if (checkpoint.blocks[0].zh) break
      await pause(5)
    }
    assert.ok(checkpoint.blocks[0].zh)
    assert.equal(checkpoint.translation.coverage.complete, 1)
    assert.equal(checkpoint.titleZh, null)
    assert.equal(checkpoint.translation.status, 'pending')
    releaseTitle()
    await assert.rejects(running, /model mismatch/)
  } finally {
    releaseTitle?.(); if (running) await running.catch(() => {})
    await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true })
  }
})

test('wrong-model and incomplete completion responses fail before block application', () => {
  assert.throws(() => assertCompletionResponse({ model: 'other-model', choices: [{ finish_reason: 'stop' }] }, 'wanted-model'), /model mismatch/)
  assert.throws(() => assertCompletionResponse({ model: 'wanted-model', choices: [{ finish_reason: 'length' }] }, 'wanted-model'), /truncated/)
  assert.throws(() => assertCompletionResponse({ model: 'wanted-model', choices: [{ finish_reason: 'tool_calls' }] }, 'wanted-model'), /did not finish/)
  assert.doesNotThrow(() => assertCompletionResponse({ model: 'wanted-model', choices: [{ finish_reason: 'stop' }] }, 'wanted-model'))
})

test('the global stop callback fires before an accepted sibling is released', async () => {
  let releaseSibling, stopped = false
  const sibling = new Promise(resolve => { releaseSibling = resolve })
  const running = runBoundedTasks(['fatal', 'active', 'queued'], async item => {
    if (item === 'fatal') { await pause(5); throw new Error('terminal failure') }
    await sibling
    return item
  }, { concurrency: 2, onError: () => { stopped = true } })
  await pause(15)
  assert.equal(stopped, true)
  releaseSibling()
  await assert.rejects(running, /terminal failure/)
})

test('an oversized-block terminal chunk stops the global gate before a held chunk drains', async () => {
  let releaseSibling, stopped = false
  const held = new Promise(resolve => { releaseSibling = resolve })
  const records = [{ id: 'fatal', text: 'first fragment' }, { id: 'active', text: 'second fragment' }]
  const running = translateWithSplitting(records, async chunk => {
    if (chunk[0].id === 'fatal') { await pause(5); throw new Error('terminal chunk failure') }
    await held
    return chunk.map(record => ({ id: record.id, text: '译文' }))
  }, { maximumRecords: 1, concurrency: 2, attempts: 1, onError: () => { stopped = true } })
  await pause(15)
  assert.equal(stopped, true)
  releaseSibling()
  await assert.rejects(running, /terminal chunk failure/)
})
