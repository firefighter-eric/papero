import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { translationUnits, normalizeHeadingNumber, assertTranslationFidelity, technicalIdentifiers, isTechnicalLabelOnly, safeId, sha256 } from './paper-lib.mjs'
import { updateCatalog } from './import-paper.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { createRequestGate, runBoundedTasks, createSerialWriter, validateConcurrency, extractCompletionText, translationRequestBudget, protectSourceDelimiters } from './translation-workers.mjs'
import { assertModelContinuation, beginModelRun, recordModelUsage } from './translation-provenance.mjs'

const BASE_SYSTEM_PROMPT = `你是严谨的人工智能论文译者。把提供的英文文本片段完整翻译为简体中文。相同 block 的片段来自同一段 HTML，按顺序连接；有些片段被公式、引文或链接分开。context 中 ⟦id⟧ 与 ⟦/id⟧ 标出了每个片段的精确边界，⟪FORMULA⟫ 是保留的原公式。根据 context 理解句意，但只翻译当前片段的 text，绝不能把相邻片段或公式内容补到当前译文。片段不是完整句子时，也只输出对应的句子片段。例如 text="Even with" 必须译为"即使"，不能补出"即使可分离卷积..."；text="where" 译为"其中"，不能补出后面的变量解释。text="and discuss its advantages over models such as" 必须译为"并讨论其相比以下模型的优势，例如"，不得将“优势/模型”后置到引用之后或省略。每个 id 必须对应一条译文，不能遗漏、合并或新增 id。严格保留 text 内每一个阿拉伯数字、正负号、小数、百分号、技术符号、姓名、模型型号、英文基准名称、缩写和链接；不得从 context 复制本片段没有的数字。参数数量的 million/billion/trillion 使用 M/B/T 原样单位，不换算成中文数位：0.5 billion parameters 译为 0.5B 参数，72 billion parameters 译为 72B 参数，范围 0.5 to 72 billion 译为 0.5B 到 72B，禁止译为 0.5亿或72亿。技术标识符 Qwen2.5-72B、GPT-4o、GSM8K 等逐字保留。完整翻译原片段每个概念：advantages 译为优势，models 译为模型，不得漏掉。译文不能加入解释、总结或审稿意见。Transformer 译为 Transformer，attention 译为注意力，self-attention 译为自注意力，multi-head attention 译为多头注意力，position-wise 译为逐位置，scaled dot-product attention 译为缩放点积注意力，sequence transduction 译为序列转换。输出只能是 JSON 对象，格式 {"translations":{"原id":"中文片段", "另一个id":"中文片段"}}。必须逐条输出所有 id，每个 id 只出现一次。不要输出 Markdown 围栏。/no_think`

const LITERAL_TRANSPORT_INSTRUCTION = ' Literal source model delimiters are represented by opaque ⟪PAPERO_LITERAL_...⟫ tokens. Preserve every token exactly, including its multiplicity, in its original translation unit. Never expand these tokens to model control tags or move them to another unit. Protocol role labels user and assistant after a source delimiter are immutable syntax; preserve them exactly.'
const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT + ` 每个 record 的 mustPreserve 列出了本片段内必须逐字出现的技术标识符。先检查全部标识符已保留，再输出。即使中文语序自然需要后置，也必须把完整概念和型号放在当前片段，不可移到下一片段。例如 text="Qwen2-72B outperforms Llama-3-70B in general " 必须译为"Qwen2-72B 在通用领域的表现优于 Llama-3-70B，包括 "；不能译为"Qwen2-72B 在通用 "，因为这漏掉了比较关系和 Llama-3-70B。` + LITERAL_TRANSPORT_INSTRUCTION

const ISOLATED_PROMPT = `Translate each exact English fragment into Simplified Chinese. This is a correction of an omitted value or identifier. Translate all meaning in this fragment, even if it is an incomplete sentence. Preserve every mustPreserve identifier, Arabic number, sign, decimal and percentage exactly. Do not copy neighboring text, infer additional facts, or add commentary. Preserve parameter quantities using M/B/T (million/billion/trillion) and context quantities using K. When automated alignment strategies synthesize artificially annotated data, translate artificially annotated as 机器标注 or 自动标注, never 人工标注. Translate are reported in Section as 详见章节 before its following immutable section link; do not end a fragment at 在第. Return only JSON: {"translations":{"original_id":"Chinese fragment"}}. /no_think` + LITERAL_TRANSPORT_INSTRUCTION

function headingText(html) {
  const $ = load(html, {}, false)
  $('annotation,annotation-xml').remove()
  return $.root().text().replace(/\s+/g, ' ').trim()
}

async function savePaper(filename, paper) {
  paper.translation.coverage = { complete: paper.blocks.filter(block => block.zh).length, total: paper.blocks.length }
  if (paper.translation.coverage.complete < paper.blocks.length) paper.translation.status = 'pending'
  const temporary = `${filename}.tmp`
  await writeFile(temporary, JSON.stringify(paper, null, 2) + '\n')
  await rename(temporary, filename)
}

export async function translatePaper(options = {}) {
  const id = options.id || 'attention-is-all-you-need', dataDir = options.dataDir || process.env.DATA_DIR || 'data'
  if (!safeId(id)) throw new Error('Invalid paper id')
  return withExclusivePaperLock(dataDir, id, () => translateUnlocked({ ...options, id, dataDir }))
}

async function translateUnlocked({ id, dataDir, endpoint = process.env.LM_STUDIO_BASE_URL || process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1', model = process.env.LM_STUDIO_MODEL || 'qwen3.8-27b-splash', allowModelChange = false, batchCharacters = 6000, maxBatches = Infinity, retranslateSourceIds = [], correctionInstructions = '', concurrency = 1, requestGate = action => action() }) {
  validateConcurrency(concurrency)
  if (typeof requestGate !== 'function') throw new Error('requestGate must be a function')
  if (typeof correctionInstructions !== 'string' || correctionInstructions.length > 3000) throw new Error('Correction instructions must be a string of at most 3000 characters')
  if (correctionInstructions && !retranslateSourceIds.length) throw new Error('Correction instructions require explicit retranslateSourceIds')
  const instructionsSha256 = correctionInstructions ? sha256(correctionInstructions) : null
  const selectedCorrectionBlocks = new Set()
  const localGate = createRequestGate(concurrency)
  const completionGate = action => localGate(() => requestGate(action))
  const writeCheckpoint = createSerialWriter()
  const runToken = `${Date.now()}-${process.pid}`
  let requestSequence = 0
  if (!safeId(id)) throw new Error('Invalid paper id')
  const filename = path.join(dataDir, 'papers', id, 'paper.json')
  const paper = JSON.parse(await readFile(filename, 'utf8'))
  assertModelContinuation(paper, model, allowModelChange)
  if (!retranslateSourceIds.length && paper.titleZh && paper.blocks.every(block => block.zh)) return paper
  if (retranslateSourceIds.length) {
    const selected = paper.blocks.filter(block => retranslateSourceIds.includes(block.sourceId) || retranslateSourceIds.includes(block.id))
    if (selected.length !== new Set(retranslateSourceIds).size) throw new Error('One or more requested correction block ids do not exist')
    selected.forEach(block => selectedCorrectionBlocks.add(block.id))
    const historyFile = path.join(path.dirname(filename), 'translation-correction-history.json')
    let history = []
    try { history = JSON.parse(await readFile(historyFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    history.push({ requestedAt: new Date().toISOString(), promptSha256: paper.translation.promptSha256, ...(correctionInstructions ? { correctionInstructions, instructionsSha256 } : {}), blocks: selected.map(block => ({ id: block.id, sourceId: block.sourceId, zh: block.zh, translation: block.translation })) })
    await writeFile(historyFile, JSON.stringify(history, null, 2) + '\n')
    paper.translation.corrections = [...(paper.translation.corrections || []), { sourceIds: selected.map(block => block.sourceId), method: 'model-retranslation-with-explicit-node-boundaries', requestedAt: new Date().toISOString(), previousPromptSha256: paper.translation.promptSha256, ...(instructionsSha256 ? { instructionsSha256 } : {}) }]
    for (const block of selected) block.zh = null
  }
  const apiBase = endpoint.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1'
  const modelResponse = await fetch(`${apiBase}/models`, { signal: AbortSignal.timeout(10000) })
  if (!modelResponse.ok) throw new Error(`LM Studio model inventory failed (${modelResponse.status})`)
  const inventory = await modelResponse.json()
  if (!inventory.data?.some(item => item.id === model)) throw new Error(`Requested model ${model} is not available. No model substitution was made.`)
  let modelIdentity = { apiModelId: model }
  try {
    const nativeResponse = await fetch(`${apiBase.replace(/\/v1$/, '')}/api/v1/models`, { signal: AbortSignal.timeout(5000) })
    if (nativeResponse.ok) {
      const nativeInventory = await nativeResponse.json()
      const identity = nativeInventory.models?.find(item => item.key === model || item.loaded_instances?.some(instance => instance.id === model))
      if (identity) {
        const instance = identity.loaded_instances?.find(item => item.id === model)
        modelIdentity = {
          apiModelId: model, displayName: identity.display_name, publisher: identity.publisher,
          format: identity.format, quantization: identity.quantization?.name,
          parameters: identity.params_string, architecture: identity.architecture,
          installedModelKey: identity.key, contextLength: instance?.config?.context_length,
          sizeBytes: identity.size_bytes, verifiedAt: new Date().toISOString(),
        }
      }
    }
  } catch { /* OpenAI-compatible endpoints may not expose the optional LM Studio identity endpoint. */ }
  const requestBudget = translationRequestBudget(modelIdentity.contextLength, batchCharacters)
  const parameters = { temperature: 0.1, top_p: 0.9, max_tokens: requestBudget.maxTokens, seed: 42, reasoning_effort: 'none', stream: false }
  beginModelRun(paper, { model, modelIdentity, provider: 'LM Studio local API', parameters, promptSha256: sha256(SYSTEM_PROMPT), startedAt: new Date().toISOString(), requestBudget })
  paper.translation = {
    ...paper.translation, status: 'pending', model, provider: 'LM Studio local API',
    method: 'DOM text node translation; original equations, citations, images and document structure preserved',
    createdAt: paper.translation.createdAt || new Date().toISOString(), parameters,
    promptSha256: sha256(SYSTEM_PROMPT), humanReviewed: false,
    correctionPromptSha256: sha256(ISOLATED_PROMPT),
    concurrency,
    modelIdentity,
    requestBudget,
    literalTransport: 'opaque-model-delimiters-v2',
    retryPolicy: { attemptsPerRequest: 3, seeds: [42, 43, 44], splitFailedRequests: true },
    notes: ['机器翻译，未经人工校对。', '公式、引文编号、参考文献作者与出版信息保留原文。', '图中的嵌入文字保留原图；图注和表格中的可提取文字已翻译。'],
  }
  const jobs = []
  for (const block of paper.blocks) {
    if (block.zh) continue
    const prepared = translationUnits(block.en, block.kind)
    const { units } = prepared
    if (!units.length) { block.zh = block.en; block.translation = { status: 'preserved', model: null }; continue }
    jobs.push({ id: block.id, texts: units.map(unit => unit.text), context: prepared.context(block.id), block })
  }
  if (!paper.titleZh) jobs.unshift({ id: '__title', texts: [paper.title], context: 'Paper title' })
  const batches = []
  while (jobs.length && batches.length < maxBatches) {
    const batch = []
    let size = 0
    while (jobs.length && (!batch.length || (size + jobs[0].texts.join('').length <= requestBudget.batchSourceCharacters && batch.reduce((count, job) => count + job.texts.length, 0) + jobs[0].texts.length <= requestBudget.maximumRecords))) {
      const job = jobs.shift(); batch.push(job); size += job.texts.join('').length
    }
    batches.push({ batch, size })
  }
  try {
    await runBoundedTasks(batches, async ({ batch, size }, batchIndex) => {
    const batchNumber = batchIndex + 1
    const acceptedCache = new Map()
    const records = batch.flatMap(({ id: recordId, texts }) => texts.map((sourceText, unitIndex) => ({ id: `${recordId}:${unitIndex}`, text: sourceText, block: recordId, mustPreserve: technicalIdentifiers(sourceText) })))
    const contexts = batch.map(({ id: recordId, context }) => ({ block: recordId, context }))
    const correctedUnitIds = new Set()
    let results
    try {
      const requestUnits = async (requestRecords, requestContexts, prompt, attempt) => {
        const responseFormat = {
          type: 'json_schema', json_schema: { name: 'paper_translation', strict: true, schema: {
            type: 'object', properties: { translations: {
              type: 'object', properties: Object.fromEntries(requestRecords.map(record => [record.id, { type: 'string' }])),
              required: requestRecords.map(record => record.id), additionalProperties: false,
            } }, required: ['translations'], additionalProperties: false,
          } },
        }
        const transport = protectSourceDelimiters(requestRecords, requestContexts)
        const output = await completionGate(async () => {
          const response = await fetch(`${apiBase}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(600000),
            body: JSON.stringify({ model, ...parameters, seed: parameters.seed + attempt - 1, response_format: responseFormat, messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ contexts: transport.contexts, records: transport.records, ...(correctionInstructions && requestRecords.some(record => selectedCorrectionBlocks.has(record.block)) ? { correctionInstructions } : {}) }) }] }),
          })
          if (!response.ok) throw new Error(`LM Studio completion failed (${response.status}): ${(await response.text()).slice(0, 600)}`)
          return response.json()
        })
        const { content, responseChannel } = extractCompletionText(output, { expectedModel: model, expectedIds: requestRecords.map(record => record.id) })
        // Per-request names cannot be overwritten by concurrent batch workers.
        const responseFile = `translation-response-${runToken}-${++requestSequence}.json`
        await writeFile(path.join(path.dirname(filename), responseFile), JSON.stringify({ model, modelIdentity, parameters: { ...parameters, seed: parameters.seed + attempt - 1 }, records: requestRecords, transportRecords: transport.records, content, responseChannel, usage: output.usage, promptSha256: sha256(prompt) }, null, 2) + '\n')
        recordModelUsage(paper.translation, model, output.usage)
        return { content, responseChannel, restore: transport.restore }
      }
      results = await translateWithSplitting(records, async (requestRecords, attempt) => {
        const pendingRecords = requestRecords.filter(record => !acceptedCache.has(record.id))
        if (!pendingRecords.length) return requestRecords.map(record => acceptedCache.get(record.id))
        const singleLongNode = pendingRecords.length === 1 && pendingRecords[0].text.length > requestBudget.maximumCharacters
        const requestContexts = compactRequestContexts(contexts, pendingRecords, { maximumCharacters: singleLongNode ? requestBudget.maximumSingleLongUnitContext : requestBudget.maximumContextCharacters, maximumPerBlock: requestBudget.maximumContextPerBlock })
        const { content, responseChannel, restore } = await requestUnits(pendingRecords, requestContexts, SYSTEM_PROMPT, attempt)
        const checked = parseUnitResponse(content, pendingRecords, { collectFailures: true, restoreValue: restore })
        for (const result of checked.results) acceptedCache.set(result.id, { ...result, responseChannel })
        if (checked.failures.length) console.error(`[${id}] Batch ${batchNumber}: correcting ${checked.failures.length} rejected text units in isolation.`)
        for (const failure of checked.failures) {
          try {
            const [corrected] = await translateWithSplitting([failure.record], async (isolatedRecords, correctionAttempt) => {
              const isolated = await requestUnits(isolatedRecords, [], ISOLATED_PROMPT, correctionAttempt)
              return parseUnitResponse(isolated.content, isolatedRecords, { restoreValue: isolated.restore }).map(result => ({ ...result, responseChannel: isolated.responseChannel }))
            }, { maximumRecords: requestBudget.maximumRecords, maximumCharacters: requestBudget.maximumCharacters, maximumUnitCharacters: requestBudget.maximumUnitCharacters, onRetry: (error, retry) => console.error(`[${id}] Unit ${failure.record.id}, correction ${retry}: ${error.message}`) })
            acceptedCache.set(corrected.id, corrected)
            correctedUnitIds.add(corrected.id)
          } catch (error) { error.fatalUnit = failure.record.id; throw error }
        }
        return requestRecords.map(record => acceptedCache.get(record.id))
      }, {
        onRetry: (error, attempt) => console.error(`[${id}] Batch ${batchNumber}, attempt ${attempt}: ${error.message}`),
        onSplit: (count) => console.error(`[${id}] Batch ${batchNumber}: splitting ${count} text units after validation failures.`),
        concurrency,
        maximumRecords: requestBudget.maximumRecords,
        maximumCharacters: requestBudget.maximumCharacters,
        maximumUnitCharacters: requestBudget.maximumUnitCharacters,
        onError: error => requestGate.stop?.(error),
      })
    } catch (error) { throw error }
    let resultIndex = 0
    for (let index = 0; index < batch.length; index++) {
      const job = batch[index]
      const jobResults = results.slice(resultIndex, resultIndex + job.texts.length)
      const texts = jobResults.map(result => result.text)
      resultIndex += job.texts.length
      if (job.id === '__title') { paper.titleZh = texts[0]; continue }
      job.block.zh = translationUnits(job.block.en, job.block.kind).render(texts)
      job.block.translation = { status: 'machine', model, provider: 'LM Studio local API', parameters: structuredClone(parameters), modelIdentity: structuredClone(modelIdentity), requestBudget: structuredClone(requestBudget), sourceSha256: sha256(job.block.en), promptSha256: sha256(SYSTEM_PROMPT), translatedAt: new Date().toISOString(), responseChannels: [...new Set(jobResults.map(result => result.responseChannel))] }
      if (job.texts.some(text => /<\/?think>|<\|im_(?:start|end)\|>/.test(text))) job.block.translation.literalTransport = 'opaque-model-delimiters-v2'
      if (instructionsSha256 && selectedCorrectionBlocks.has(job.id)) job.block.translation.reviewCorrection = { method: 'scoped-review-instructions', instructionsSha256 }
      const corrections = [...correctedUnitIds].filter(unitId => unitId.startsWith(`${job.id}:`))
      if (corrections.length) job.block.translation.corrections = { method: 'isolated-fragment-retranslation', unitIds: corrections, promptSha256: sha256(ISOLATED_PROMPT) }
      if (job.block.kind === 'heading') {
        const normalized = normalizeHeadingNumber(job.block.en, job.block.zh)
        if (normalized !== job.block.zh) {
          job.block.zh = normalized
          job.block.translation.normalizations = ['preserve-original-section-number-v1']
        }
        const section = paper.sections.find(item => item.id === job.block.sectionId)
        if (section) section.titleZh = headingText(job.block.zh)
      }
    }
    paper.translation.coverage = { complete: paper.blocks.filter(block => block.zh).length, total: paper.blocks.length }
    paper.translation.updatedAt = new Date().toISOString()
    if (paper.translation.coverage.complete === paper.blocks.length && paper.titleZh) {
      paper.translation.status = 'machine'
      paper.translation.completedAt = new Date().toISOString()
    }
    paper.abstractZh = paper.blocks.filter(block => block.sectionId.startsWith('abstract') && block.kind !== 'heading' && block.zh).map(block => load(block.zh).text()).join(' ')
    await writeCheckpoint(async () => {
      const checkpoint = structuredClone(paper)
      await savePaper(filename, checkpoint)
      await updateCatalog(dataDir, checkpoint)
      console.log(`[${id}] Batch ${batchNumber}: ${checkpoint.translation.coverage.complete}/${paper.blocks.length} blocks translated (${size} source characters).`)
    })
    }, { concurrency, onError: error => requestGate.stop?.(error) })
  } catch (error) {
    await writeCheckpoint(async () => { await savePaper(filename, paper); await updateCatalog(dataDir, paper) })
    throw error
  }
  const normalizedBlocks = []
  // Apply deterministic normalization on resume too, without another model request.
  for (const block of paper.blocks) {
    if (block.kind !== 'heading' || !block.zh) continue
    const normalized = normalizeHeadingNumber(block.en, block.zh)
    if (normalized !== block.zh) {
      block.zh = normalized
      block.translation = { ...block.translation, normalizations: ['preserve-original-section-number-v1'] }
      normalizedBlocks.push(block.id)
    }
    const section = paper.sections.find(item => item.id === block.sectionId)
    if (section) section.titleZh = headingText(block.zh)
  }
  if (normalizedBlocks.length || paper.blocks.some(block => block.translation?.normalizations?.length)) paper.translation.normalization = {
    method: 'preserve-original-section-number-v1',
    description: 'Remove an exact repeated leading section number from translated heading text when the original ltx_tag already supplies it; preserve all original markup, ids and formulas.',
    blocks: paper.blocks.filter(block => block.translation?.normalizations?.includes('preserve-original-section-number-v1')).map(block => block.id),
  }
  paper.translation.coverage = { complete: paper.blocks.filter(block => block.zh).length, total: paper.blocks.length }
  if (paper.translation.coverage.complete === paper.blocks.length && paper.titleZh) {
    paper.translation.status = 'machine'
    paper.translation.completedAt ||= new Date().toISOString()
  }
  await savePaper(filename, paper)
  await updateCatalog(dataDir, paper)
  return paper
}

export function assertCompletionResponse(output, model) {
  if (output.model !== model) throw new Error(`Completion model mismatch: expected ${model}, received ${output.model || 'unknown'}`)
  const finish = output.choices?.[0]?.finish_reason
  if (finish === 'length') throw new Error('Model output was truncated; reduce TRANSLATION_BATCH_CHARACTERS')
  if (finish !== 'stop') throw new Error(`Completion did not finish successfully: ${finish || 'unknown'}`)
}

export function compactRequestContexts(contexts, records, { maximumCharacters = 4000, maximumPerBlock = 1200 } = {}) {
  const relevant = contexts.filter(context => records.some(record => record.block === context.block))
  let remaining = maximumCharacters
  return relevant.map((item, index) => {
    const budget = Math.min(maximumPerBlock, Math.floor(remaining / (relevant.length - index)))
    const firstRecord = records.find(record => record.block === item.block)
    const marker = `⟦${firstRecord.id}⟧`
    const position = Math.max(0, item.context.indexOf(marker))
    const start = Math.max(0, position - Math.floor(budget / 4))
    const context = item.context.slice(start, start + budget)
    remaining -= context.length
    return { block: item.block, context }
  })
}

export async function translateWithSplitting(records, request, { attempts = 3, maximumRecords = 80, maximumCharacters = 6000, maximumUnitCharacters = maximumCharacters, concurrency = 1, onRetry = () => {}, onSplit = () => {}, onError = () => {} } = {}) {
  for (const record of records) if (record.text.length > maximumUnitCharacters) throw new Error(`Translation text unit ${record.id} exceeds ${maximumUnitCharacters} characters`)
  if (records.length > maximumRecords || (records.length > 1 && records.reduce((sum, record) => sum + record.text.length, 0) > maximumCharacters)) {
    const chunks = []
    let index = 0
    while (index < records.length) {
      const chunk = []
      let characters = 0
      while (index < records.length && chunk.length < maximumRecords && (!chunk.length || characters + records[index].text.length <= maximumCharacters)) {
        characters += records[index].text.length
        chunk.push(records[index++])
      }
      chunks.push(chunk)
    }
    return (await runBoundedTasks(chunks, chunk => translateWithSplitting(chunk, request, { attempts, maximumRecords, maximumCharacters, maximumUnitCharacters, concurrency, onRetry, onSplit, onError }), { concurrency, onError })).flat()
  }
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await request(records, attempt) } catch (error) {
      if (error.fatalUnit) throw error
      lastError = error; onRetry(error, attempt)
    }
  }
  if (lastError?.cause?.code === 'ECONNREFUSED') throw lastError
  if (records.length <= 1) throw lastError
  onSplit(records.length)
  const middle = Math.ceil(records.length / 2)
  const options = { attempts, maximumRecords, maximumCharacters, maximumUnitCharacters, concurrency, onRetry, onSplit, onError }
  const first = await translateWithSplitting(records.slice(0, middle), request, options)
  const second = await translateWithSplitting(records.slice(middle), request, options)
  return [...first, ...second]
}

export function parseUnitResponse(content, records, { collectFailures = false, restoreValue = (_id, text) => text } = {}) {
  // Strip only an optional outer reasoning prefix. Literal <think> delimiters
  // inside the JSON are source content in the Qwen3.5 reasoning examples.
  const stripped = content.trim().replace(/^<think>[\s\S]*?<\/think>\s*/, '').replace(/^```(?:json)?\s*|\s*```$/g, '')
  const start = stripped.indexOf('{'), end = stripped.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Model response contains no JSON object')
  const parsed = JSON.parse(stripped.slice(start, end + 1))
  const translations = Array.isArray(parsed.translations) ? parsed.translations : Object.entries(parsed.translations ?? {}).map(([id, text]) => ({ id, text }))
  if (translations.length !== records.length) throw new Error(`Model returned ${translations.length} units; expected ${records.length}`)
  const map = new Map()
  for (const item of translations) {
    if (map.has(item.id) || typeof item.text !== 'string' || !item.text.trim()) throw new Error(`Duplicate or empty translation unit ${item.id}`)
    map.set(item.id, item)
  }
  const results = [], failures = []
  for (const record of records) {
    const raw = map.get(record.id)
    if (!raw) throw new Error(`Missing translation unit ${record.id}`)
    try {
      const result = { ...raw, text: restoreValue(record.id, raw.text) }
      if (record.text.length > 70 && !/[\u3400-\u9fff]/.test(result.text)) {
        const sameLabels = text => text.normalize('NFKC').replace(/[\s、,;:()。]/g, '').toLowerCase()
        if (!isTechnicalLabelOnly(record.text) || sameLabels(record.text) !== sameLabels(result.text)) throw new Error(`No Chinese translation for ${record.id}`)
      }
      assertTranslationFidelity(record.text, result.text)
      results.push(result)
    } catch (error) {
      if (!collectFailures) throw error
      failures.push({ record, error: error.message })
    }
  }
  return collectFailures ? { results, failures } : results
}

export function parseTranslationArgs(args) {
  const options = { concurrency: 1, allowModelChange: false, batchCharacters: Number(process.env.TRANSLATION_BATCH_CHARACTERS) || 6000, maxBatches: Infinity }
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split('=', 2)
    if (flag === '--model' || flag === '--concurrency') {
      const value = inline ?? args[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
      if (flag === '--model') options.model = value
      else options.concurrency = Number(value)
    } else if (flag === '--allow-model-change' || flag === '--one-batch') {
      if (inline !== undefined) throw new Error(`${flag} does not accept a value`)
      if (flag === '--allow-model-change') options.allowModelChange = true
      else options.maxBatches = 1
    }
    else if (flag.startsWith('--')) throw new Error(`Unknown translation option ${flag}`)
    else if (options.id) throw new Error('Only one paper id may be supplied')
    else options.id = args[index]
  }
  options.id ||= 'attention-is-all-you-need'
  validateConcurrency(options.concurrency)
  return options
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  Promise.resolve().then(() => translatePaper(parseTranslationArgs(process.argv.slice(2)))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
