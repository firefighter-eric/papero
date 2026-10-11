import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { load } from 'cheerio'
import { assertTranslationFidelity, isTechnicalLabelOnly, normalizeHeadingNumber, safeId, sanitizeHtml, sha256, translationUnits, translatedAbstractText } from './paper-lib.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { updateCatalog } from './import-paper.mjs'

const MODEL = 'gpt-6-luna', PROVIDER = 'Codex subagent'
const LOCAL_MODEL = 'qwen3.6-35b-a3b', LOCAL_PROVIDER = 'LM Studio local API'
const PARAMETERS = { reasoning_effort: 'low' }, IDENTITY = { apiModelId: MODEL }
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && !!value.trim()
const timestamp = value => nonempty(value) && Number.isFinite(Date.parse(value))
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right))
const manifestHash = value => sha256(JSON.stringify(ordered(value)))
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const identityFacts = identity => Object.fromEntries(Object.entries(identity || {}).filter(([key]) => key !== 'verifiedAt'))
const physicalIdentityFacts = identity => Object.fromEntries(Object.entries(identityFacts(identity)).filter(([key]) => key !== 'contextLength'))
const knownLocalIdentity = { apiModelId: LOCAL_MODEL, displayName: 'Qwen3.6 35B A3B', publisher: 'mlx-community', format: 'mlx',
  quantization: '4bit', parameters: '35B', architecture: 'qwen3_5_moe', installedModelKey: LOCAL_MODEL, sizeBytes: 20429166969 }
const budgetKeys = ['maxTokens', 'batchSourceCharacters', 'maximumCharacters', 'maximumRecords', 'maximumUnitCharacters', 'maximumContextCharacters', 'maximumContextPerBlock', 'maximumSingleLongUnitContext']
const validLocalIdentity = identity => record(identity) && same(physicalIdentityFacts(identity), knownLocalIdentity)
  && timestamp(identity.verifiedAt) && Number.isSafeInteger(identity.contextLength) && identity.contextLength > 0
const validLocalParameters = parameters => record(parameters) && Number.isFinite(parameters.temperature) && parameters.temperature >= 0 && parameters.temperature <= 2
  && Number.isFinite(parameters.top_p) && parameters.top_p > 0 && parameters.top_p <= 1
  && Number.isSafeInteger(parameters.max_tokens) && parameters.max_tokens > 0 && Number.isSafeInteger(parameters.seed)
  && parameters.reasoning_effort === 'none' && parameters.stream === false
const validLocalBudget = (budget, parameters) => exactKeys(budget, budgetKeys) && budgetKeys.every(key => Number.isSafeInteger(budget[key]) && budget[key] > 0)
  && budget.maxTokens === parameters.max_tokens
const validLocalUsage = usage => record(usage) && Number.isSafeInteger(usage.promptTokens) && Number.isSafeInteger(usage.completionTokens)
  && Object.entries(usage).every(([key, value]) => ['promptTokens', 'completionTokens', 'observedReasoningTokens', 'reasoningUsageResponses'].includes(key) && Number.isSafeInteger(value) && value >= 0)
const localOnlyFields = ['requestBudget', 'literalTransport', 'correctionPromptSha256', 'concurrency', 'retryPolicy']

function acceptedBlocks(paper) {
  return paper.blocks.filter(block => block.zh).map(block => ({ id: block.id, sourceSha256: sha256(block.en),
    translatedSha256: sha256(block.zh), translationSha256: manifestHash(block.translation) }))
}

function assertQwenCheckpoint(paper, previous, cutoff) {
  const fail = () => { throw new Error('Invalid existing Qwen fallback provenance or declared API history') }
  const complete = paper.blocks.filter(block => block.zh).length
  if (previous.model !== LOCAL_MODEL || previous.provider !== LOCAL_PROVIDER || previous.status !== 'pending' || previous.humanReviewed !== false
    || previous.codexFallback !== undefined || !validLocalIdentity(previous.modelIdentity) || !validLocalParameters(previous.parameters)
    || !validLocalBudget(previous.requestBudget, previous.parameters) || !fingerprint(previous.promptSha256)
    || !timestamp(previous.createdAt) || !timestamp(previous.updatedAt) || Date.parse(previous.createdAt) > Date.parse(previous.updatedAt)
    || Date.parse(previous.updatedAt) > Date.parse(cutoff)
    || !same(previous.coverage, { complete, total: paper.blocks.length }) || complete === paper.blocks.length
    || !same(previous.modelsUsed, [LOCAL_MODEL]) || !exactKeys(previous.modelIdentities, [LOCAL_MODEL])
    || !same(previous.modelIdentities[LOCAL_MODEL], previous.modelIdentity)
    || !exactKeys(previous.usageByModel, [LOCAL_MODEL]) || !validLocalUsage(previous.usageByModel[LOCAL_MODEL])
    || !same(previous.usage, previous.usageByModel[LOCAL_MODEL]) || !Array.isArray(previous.modelHistory) || !previous.modelHistory.length
    || (previous.sourceSha256 !== undefined && previous.sourceSha256 !== paper.source.sha256)
    || (paper.titleZh && previous.titleTranslatedSha256 !== undefined && previous.titleTranslatedSha256 !== sha256(paper.titleZh))) fail()
  let lastStart = -Infinity, lastCoverage = -1
  for (const [index, run] of previous.modelHistory.entries()) {
    const start = Date.parse(run?.startedAt), coverage = run?.coverageAtStart
    if (run?.model !== LOCAL_MODEL || run.provider !== LOCAL_PROVIDER || !validLocalIdentity(run.modelIdentity)
      || !same(physicalIdentityFacts(run.modelIdentity), physicalIdentityFacts(previous.modelIdentity))
      || !validLocalParameters(run.parameters) || !validLocalBudget(run.requestBudget, run.parameters) || !fingerprint(run.promptSha256)
      // beginModelRun records the initial start before the checkpoint's
      // createdAt is assigned. Creation must fall within that initial run,
      // before every accepted machine translation and subsequent resume.
      || !timestamp(run.startedAt) || start < lastStart || start > Date.parse(previous.updatedAt)
      || (index ? start < Date.parse(previous.createdAt) : start > Date.parse(previous.createdAt))
      || run.reason !== (index ? 'resume-model' : 'initial-model') || run.previousModel !== undefined
      || !Number.isSafeInteger(coverage?.complete) || coverage.complete < lastCoverage || coverage.complete > complete || coverage.total !== paper.blocks.length) fail()
    lastStart = start; lastCoverage = coverage.complete
  }
  const active = previous.modelHistory.at(-1)
  if (!same(active.modelIdentity, previous.modelIdentity) || !same(active.parameters, previous.parameters)
    || !same(active.requestBudget, previous.requestBudget) || active.promptSha256 !== previous.promptSha256) fail()
  let machine = 0
  for (const block of paper.blocks.filter(block => block.zh)) {
    const metadata = block.translation
    if (metadata?.status === 'preserved') {
      if (metadata.model !== null || block.zh !== block.en || translationUnits(block.en, block.kind).units.length) fail()
      continue
    }
    machine++
    if (metadata?.status !== 'machine' || metadata.model !== LOCAL_MODEL || metadata.provider !== LOCAL_PROVIDER
      || !validLocalIdentity(metadata.modelIdentity) || metadata.sourceSha256 !== sha256(block.en)
      || !fingerprint(metadata.promptSha256) || !timestamp(metadata.translatedAt)
      || (metadata.translatedSha256 !== undefined && metadata.translatedSha256 !== sha256(block.zh))
      || (metadata.sourcePaperSha256 !== undefined && metadata.sourcePaperSha256 !== paper.source.sha256)
      || Date.parse(metadata.translatedAt) < Date.parse(previous.createdAt) || Date.parse(metadata.translatedAt) > Date.parse(previous.updatedAt)) fail()
    const at = Date.parse(metadata.translatedAt)
    const runs = previous.modelHistory.filter((run, index) => Date.parse(run.startedAt) <= at
      && (index === previous.modelHistory.length - 1 || at < Date.parse(previous.modelHistory[index + 1].startedAt)))
    if (!runs.some(run => same(identityFacts(metadata.modelIdentity), identityFacts(run.modelIdentity))
      && same(metadata.parameters, run.parameters) && same(metadata.requestBudget, run.requestBudget)
      && metadata.promptSha256 === run.promptSha256)) fail()
  }
  if (!machine) fail()
}

function fallbackHistory(baseline, promptSha256, startedAt) {
  return [...structuredClone(baseline.translation.modelHistory), { model: MODEL, provider: PROVIDER,
    modelIdentity: structuredClone(IDENTITY), parameters: structuredClone(PARAMETERS), promptSha256, startedAt,
    reason: 'explicit-model-change', previousModel: LOCAL_MODEL, coverageAtStart: structuredClone(baseline.translation.coverage) }]
}

/** Validate the explicit mixed-model receipt, including every frozen prior Qwen contribution. */
export function assertCodexFallbackReceipt(paper) {
  const current = paper.translation || {}, receipt = current.codexFallback
  if (receipt === undefined) return null
  const fail = () => { throw new Error('Invalid explicit Codex fallback receipt or frozen Qwen contribution') }
  if (!exactKeys(receipt, ['schemaVersion', 'method', 'fromModel', 'toModel', 'sourceSha256', 'sourceDocumentSha256', 'manifestSha256', 'prompt', 'promptSha256', 'startedAt', 'baselineSha256', 'baseline'])
    || receipt.schemaVersion !== 1 || receipt.method !== 'explicit-qwen-to-codex-continuation' || receipt.fromModel !== LOCAL_MODEL || receipt.toModel !== MODEL
    || receipt.sourceSha256 !== paper.source.sha256 || receipt.sourceDocumentSha256 !== manifestHash(sourceDocument(paper))
    || !nonempty(receipt.prompt) || receipt.promptSha256 !== sha256(receipt.prompt) || !timestamp(receipt.startedAt)
    || !exactKeys(receipt.baseline, ['translation', 'acceptedBlocks', 'title']) || receipt.baselineSha256 !== manifestHash(receipt.baseline)
    || !Array.isArray(receipt.baseline.acceptedBlocks)) fail()
  const baseline = receipt.baseline, ids = new Set()
  for (const frozen of baseline.acceptedBlocks) {
    const block = paper.blocks.find(candidate => candidate.id === frozen?.id)
    if (!exactKeys(frozen, ['id', 'sourceSha256', 'translatedSha256', 'translationSha256']) || ids.has(frozen.id) || !block?.zh
      || frozen.sourceSha256 !== sha256(block.en) || frozen.translatedSha256 !== sha256(block.zh)
      || frozen.translationSha256 !== manifestHash(block.translation)) fail()
    ids.add(frozen.id)
  }
  if (baseline.title !== null && (!exactKeys(baseline.title, ['model', 'provider', 'sourceSha256', 'translatedSha256'])
    || baseline.title.model !== LOCAL_MODEL || baseline.title.provider !== LOCAL_PROVIDER || baseline.title.sourceSha256 !== sha256(paper.title)
    || baseline.title.translatedSha256 !== sha256(paper.titleZh) || !same(current.titleTranslation, baseline.title))) fail()
  const before = { ...paper, titleZh: baseline.title ? paper.titleZh : null,
    blocks: paper.blocks.map(block => ids.has(block.id) ? block : { ...block, zh: null, translation: undefined }) }
  assertQwenCheckpoint(before, baseline.translation, receipt.startedAt)
  if (!same(acceptedBlocks(before), baseline.acceptedBlocks)) fail()
  assertRun(current, receipt.promptSha256)
  if (!same(current.modelHistory, fallbackHistory(baseline, receipt.promptSha256, receipt.startedAt))
    || !same(current.modelsUsed, [LOCAL_MODEL, MODEL]) || !same(current.modelIdentities, { ...baseline.translation.modelIdentities, [MODEL]: IDENTITY })
    || !same(current.usage, baseline.translation.usage) || !same(current.usageByModel, baseline.translation.usageByModel)
    || current.usageScope !== 'observed-api-models-only' || localOnlyFields.some(key => current[key] !== undefined) || current.sourceSha256 !== receipt.sourceSha256
    || current.manifestSha256 !== receipt.manifestSha256 || !timestamp(current.updatedAt)
    || Date.parse(current.updatedAt) < Date.parse(receipt.startedAt)) fail()
  const expected = buildManifest(paper, { prompt: receipt.prompt, createdAt: receipt.startedAt, modelChange: baseline })
  if (receipt.manifestSha256 !== manifestHash(expected)) fail()
  for (const block of paper.blocks.filter(block => block.zh && !ids.has(block.id))) {
    const metadata = block.translation
    if (metadata?.status === 'preserved') {
      if (metadata.model !== null || block.zh !== block.en || translationUnits(block.en, block.kind).units.length) fail()
      continue
    }
    assertRun(metadata || {}, receipt.promptSha256)
    if (metadata.status !== 'machine' || metadata.sourceSha256 !== sha256(block.en) || metadata.sourcePaperSha256 !== receipt.sourceSha256
      || metadata.translatedSha256 !== sha256(block.zh) || !fingerprint(metadata.draftSha256) || !timestamp(metadata.translatedAt)
      || Date.parse(metadata.translatedAt) < Date.parse(receipt.startedAt) || Date.parse(metadata.translatedAt) > Date.parse(current.updatedAt)
      || ['usage', 'usageByModel', 'requestBudget'].some(key => metadata[key] !== undefined)) fail()
  }
  if (paper.titleZh) {
    if (current.titleTranslatedSha256 !== sha256(paper.titleZh)) fail()
    if (!baseline.title) {
      const title = current.titleTranslation
      assertRun(title || {}, receipt.promptSha256)
      if (title.sourceSha256 !== sha256(paper.title) || title.translatedSha256 !== sha256(paper.titleZh) || !timestamp(title.translatedAt)
        || Date.parse(title.translatedAt) < Date.parse(receipt.startedAt) || Date.parse(title.translatedAt) > Date.parse(current.updatedAt)
        || ['usage', 'usageByModel', 'requestBudget'].some(key => title[key] !== undefined)) fail()
    }
  } else if (current.titleTranslation !== undefined || current.titleTranslatedSha256 !== undefined) fail()
  return receipt
}

function sourceDocument(paper) {
  return { schemaVersion: paper.schemaVersion, id: paper.id, arxivId: paper.arxivId, title: paper.title,
    authors: paper.authors, year: paper.year, tags: paper.tags, abstract: paper.abstract, source: paper.source,
    sections: paper.sections.map(({ id, title, level }) => ({ id, title, level })),
    blocks: paper.blocks.map(({ id, sourceId, sectionId, kind, en }) => ({ id, sourceId, sectionId, kind, en })),
    statistics: paper.statistics, assets: paper.assets }
}

/** Freeze the exact original DOM text fragments before dispatching real Codex translation work. */
export function createCodexTranslationManifest(paper, { prompt, createdAt = new Date().toISOString(), allowModelChange = false } = {}) {
  if (typeof allowModelChange !== 'boolean') throw new Error('allowModelChange must be an explicit boolean')
  let modelChange
  if (paper?.translation?.codexFallback !== undefined) {
    const receipt = assertCodexFallbackReceipt(paper)
    if (prompt !== receipt.prompt || createdAt !== receipt.startedAt) throw new Error('Codex continuation manifest changed')
    modelChange = structuredClone(receipt.baseline)
  } else if (allowModelChange && paper?.translation?.model && paper.translation.model !== MODEL) {
    assertQwenCheckpoint(paper, paper.translation, createdAt)
    modelChange = { translation: structuredClone(paper.translation), acceptedBlocks: acceptedBlocks(paper),
      title: paper.titleZh ? { model: LOCAL_MODEL, provider: LOCAL_PROVIDER, sourceSha256: sha256(paper.title), translatedSha256: sha256(paper.titleZh) } : null }
  }
  return buildManifest(paper, { prompt, createdAt, modelChange })
}

function buildManifest(paper, { prompt, createdAt, modelChange }) {
  if (!safeId(paper?.id) || !nonempty(paper.title) || !/^[a-f0-9]{64}$/.test(paper.source?.sha256)
    || !Array.isArray(paper.blocks) || !paper.blocks.length || !Array.isArray(paper.sections)
    || !nonempty(prompt) || !timestamp(createdAt)) throw new Error('Invalid paper, prompt or timestamp for Codex translation manifest')
  const seen = new Set()
  const blocks = [], jobs = [{ id: '__title:0', blockId: '__title', unitId: '0', text: paper.title, sourceTextSha256: sha256(paper.title) }]
  for (const block of paper.blocks) {
    if (!nonempty(block.id) || block.id === '__title' || seen.has(block.id) || !nonempty(block.en)
      || sanitizeHtml(block.en) !== block.en) throw new Error('Invalid, unsafe or duplicate manifest source block')
    seen.add(block.id)
    const { units } = translationUnits(block.en, block.kind)
    blocks.push({ id: block.id, sourceId: block.sourceId, sectionId: block.sectionId, kind: block.kind,
      sourceBlockSha256: sha256(block.en), unitIds: units.map(unit => `${block.id}:${unit.id}`) })
    jobs.push(...units.map(unit => ({ id: `${block.id}:${unit.id}`, blockId: block.id, unitId: unit.id, text: unit.text, sourceTextSha256: sha256(unit.text) })))
  }
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error('Duplicate manifest translation job id')
  return { schemaVersion: 1, paperId: paper.id, sourceSha256: paper.source.sha256,
    sourceDocumentSha256: manifestHash(sourceDocument(paper)), titleSha256: sha256(paper.title),
    model: MODEL, provider: PROVIDER, parameters: structuredClone(PARAMETERS), modelIdentity: structuredClone(IDENTITY),
    prompt, promptSha256: sha256(prompt), createdAt, blocks, jobs, ...(modelChange ? { modelChange } : {}) }
}

function assertRun(run, promptSha256) {
  if (run.model !== MODEL || run.provider !== PROVIDER || !same(run.parameters, PARAMETERS)
    || !same(run.modelIdentity, IDENTITY) || run.promptSha256 !== promptSha256) throw new Error('Codex draft model, provider, identity, parameters or prompt hash mismatch')
}

function assertFragment(job, text) {
  if (!nonempty(text)) throw new Error(`Empty translation unit ${job.id}`)
  if (job.text.length > 70 && !/[\u3400-\u9fff]/.test(text)) {
    const labels = value => value.normalize('NFKC').replace(/[\s、,;:()。]/g, '').toLowerCase()
    if (!isTechnicalLabelOnly(job.text) || labels(job.text) !== labels(text)) throw new Error(`No Chinese translation for ${job.id}`)
  }
  try { assertTranslationFidelity(job.text, text) } catch (error) {
    throw new Error(`Codex translation fidelity failed for ${job.id}: ${error.message}`, { cause: error })
  }
}

function headingText(html) {
  const $ = load(html, {}, false)
  $('annotation,annotation-xml').remove()
  return $.root().text().replace(/\s+/g, ' ').trim()
}

/** Apply independently observed draft outputs. No model call, token estimates, HTML draft or public export is performed. */
export async function applyCodexTranslations({ dataDir = process.env.DATA_DIR || 'data', id, manifest, drafts, allowModelChange = false } = {}) {
  if (!safeId(id)) throw new Error('Invalid paper id')
  if (typeof allowModelChange !== 'boolean') throw new Error('allowModelChange must be an explicit boolean')
  if (!Array.isArray(drafts) || !drafts.length) throw new Error('At least one Codex draft is required')
  return withExclusivePaperLock(dataDir, id, async () => {
    const filename = path.join(dataDir, 'papers', id, 'paper.json')
    const paper = JSON.parse(await readFile(filename, 'utf8'))
    if (paper.id !== id || manifest?.paperId !== id) throw new Error('Codex manifest paper id mismatch')
    const previous = paper.translation || {}
    if (previous.model && previous.model !== MODEL && !allowModelChange) throw new Error('Codex primary translation cannot replace another model run')
    const expected = createCodexTranslationManifest(paper, { prompt: manifest.prompt, createdAt: manifest.createdAt, allowModelChange })
    if (!same(manifest, expected)) throw new Error('Frozen Codex manifest or source document mismatch; original source drifted or a fingerprint changed')
    const fallback = manifest.modelChange
    if (!fallback && ['modelHistory', 'modelsUsed', 'modelIdentities', 'usageByModel', 'usage', 'requestBudget'].some(key => previous[key] !== undefined)) {
      throw new Error('Codex primary translation cannot invent or replace API usage, budgets or declared model history')
    }
    if (!fallback && previous.model) assertRun(previous, manifest.promptSha256)
    if (previous.model === MODEL && (previous.manifestSha256 !== manifestHash(manifest) || previous.sourceSha256 !== paper.source.sha256)) throw new Error('Codex continuation manifest changed')
    if (!fallback && paper.titleZh && (!previous.model || previous.titleTranslatedSha256 !== sha256(paper.titleZh))) throw new Error('Existing Codex title translation changed or lacks observed provenance')
    for (const block of paper.blocks.filter(block => block.zh && !fallback)) {
      if (block.translation?.status === 'preserved' && block.zh === block.en && block.translation.model === null) continue
      assertRun(block.translation || {}, manifest.promptSha256)
      if (block.translation.status !== 'machine' || block.translation.sourceSha256 !== sha256(block.en)
        || block.translation.sourcePaperSha256 !== paper.source.sha256 || block.translation.translatedSha256 !== sha256(block.zh)
        || ['usage', 'usageByModel', 'requestBudget'].some(key => block.translation[key] !== undefined)) throw new Error('Existing Codex translation provenance is stale')
    }
    const jobs = new Map(manifest.jobs.map(job => [job.id, job])), accepted = new Map()
    const now = new Date().toISOString()
    const draftKeys = ['jobIds', 'translations', 'model', 'provider', 'parameters', 'modelIdentity', 'promptSha256', 'translatedAt']
    for (const draft of drafts) {
      if (!exactKeys(draft, draftKeys) || !Array.isArray(draft.jobIds) || !draft.jobIds.length
        || !draft.jobIds.every(nonempty) || new Set(draft.jobIds).size !== draft.jobIds.length
        || !exactKeys(draft.translations, draft.jobIds)) throw new Error('Codex draft has missing, duplicate or extra translation job IDs or fields')
      assertRun(draft, manifest.promptSha256)
      if (!timestamp(draft.translatedAt) || Date.parse(draft.translatedAt) < Date.parse(manifest.createdAt)
        || Date.parse(draft.translatedAt) > Date.parse(now)) throw new Error('Invalid observed Codex draft translation timestamp')
      for (const jobId of draft.jobIds) {
        const job = jobs.get(jobId)
        if (!job || accepted.has(jobId)) throw new Error(`Unknown or duplicate Codex draft job ID ${jobId}`)
        if (job.blockId === '__title' ? paper.titleZh : paper.blocks.find(block => block.id === job.blockId)?.zh) {
          throw new Error(`Codex draft would replace an accepted translation: ${jobId}`)
        }
        assertFragment(job, draft.translations[jobId])
        accepted.set(jobId, { text: draft.translations[jobId], translatedAt: draft.translatedAt })
      }
    }
    for (const block of manifest.blocks) {
      const supplied = block.unitIds.filter(jobId => accepted.has(jobId))
      if (supplied.length && supplied.length !== block.unitIds.length) throw new Error(`Missing Codex draft unit IDs for complete block ${block.id}`)
    }
    if (accepted.has('__title:0')) paper.titleZh = accepted.get('__title:0').text
    for (const block of paper.blocks) {
      if (block.zh) continue
      const { units, render } = translationUnits(block.en, block.kind)
      if (!units.length) { block.zh = block.en; block.translation = { status: 'preserved', model: null }; continue }
      const unitIds = units.map(unit => `${block.id}:${unit.id}`)
      if (!unitIds.every(jobId => accepted.has(jobId))) continue
      const texts = unitIds.map(jobId => accepted.get(jobId).text)
      block.zh = render(texts)
      block.translation = { status: 'machine', model: MODEL, provider: PROVIDER,
        parameters: structuredClone(PARAMETERS), modelIdentity: structuredClone(IDENTITY), sourceSha256: sha256(block.en),
        sourcePaperSha256: paper.source.sha256, promptSha256: manifest.promptSha256,
        translatedAt: unitIds.map(jobId => accepted.get(jobId).translatedAt).sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1),
        draftSha256: manifestHash(Object.fromEntries(unitIds.map((jobId, index) => [jobId, texts[index]]))) }
      if (block.kind === 'heading') {
        const normalized = normalizeHeadingNumber(block.en, block.zh)
        if (normalized !== block.zh) { block.zh = normalized; block.translation.normalizations = ['preserve-original-section-number-v1'] }
        const section = paper.sections.find(section => section.id === block.sectionId)
        if (section) section.titleZh = headingText(block.zh)
      }
      block.translation.translatedSha256 = sha256(block.zh)
    }
    const complete = paper.blocks.filter(block => block.zh).length
    paper.translation = { ...previous, status: complete === paper.blocks.length && paper.titleZh ? 'machine' : 'pending',
      model: MODEL, provider: PROVIDER, modelIdentity: structuredClone(IDENTITY), parameters: structuredClone(PARAMETERS),
      method: 'Codex subagent DOM text node fragment translation; original equations, citations, images and document structure preserved',
      humanReviewed: false, promptSha256: manifest.promptSha256, manifestSha256: manifestHash(manifest),
      sourceSha256: paper.source.sha256, createdAt: previous.createdAt || manifest.createdAt, updatedAt: now,
      coverage: { complete, total: paper.blocks.length } }
    if (fallback) {
      paper.translation.modelHistory = fallbackHistory(fallback, manifest.promptSha256, manifest.createdAt)
      paper.translation.modelsUsed = [LOCAL_MODEL, MODEL]
      paper.translation.modelIdentities = { ...structuredClone(fallback.translation.modelIdentities), [MODEL]: structuredClone(IDENTITY) }
      paper.translation.usageScope = 'observed-api-models-only'
      for (const key of localOnlyFields) delete paper.translation[key]
      paper.translation.codexFallback = previous.codexFallback || { schemaVersion: 1, method: 'explicit-qwen-to-codex-continuation',
        fromModel: LOCAL_MODEL, toModel: MODEL, sourceSha256: paper.source.sha256, sourceDocumentSha256: manifest.sourceDocumentSha256,
        manifestSha256: manifestHash(manifest), prompt: manifest.prompt, promptSha256: manifest.promptSha256, startedAt: manifest.createdAt,
        baselineSha256: manifestHash(fallback), baseline: structuredClone(fallback) }
      if (fallback.title) paper.translation.titleTranslation = structuredClone(fallback.title)
      else if (accepted.has('__title:0')) paper.translation.titleTranslation = { model: MODEL, provider: PROVIDER, parameters: structuredClone(PARAMETERS),
        modelIdentity: structuredClone(IDENTITY), promptSha256: manifest.promptSha256, sourceSha256: sha256(paper.title),
        translatedSha256: sha256(paper.titleZh), translatedAt: accepted.get('__title:0').translatedAt }
    }
    if (paper.translation.status === 'machine') paper.translation.completedAt = now
    else delete paper.translation.completedAt
    if (paper.titleZh) paper.translation.titleTranslatedSha256 = sha256(paper.titleZh)
    if (fallback) assertCodexFallbackReceipt(paper)
    paper.abstractZh = translatedAbstractText(paper.blocks)
    const temporary = `${filename}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(paper, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, filename) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    await updateCatalog(dataDir, paper)
    return paper
  })
}
