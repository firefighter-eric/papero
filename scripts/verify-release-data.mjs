import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { inspectPublicData } from './prepare-data.mjs'
import { assertCodexFallbackReceipt } from './apply-codex-translations.mjs'
import { assertPdfProvenance } from './pdf-provenance.mjs'
import { assertAuthorArticleProvenance } from './author-article-lib.mjs'
import { assertChineseHeadingCompleteness } from './heading-provenance.mjs'
import { publicationAuthors } from './publication-bibliography.mjs'
import { sourceAssetMetadata } from './publication-assets.mjs'
import { assertTranslationFidelity, catalogEntry, sanitizeHtml, sanitizeSvg, sha256, translationUnits, validArxivId, visibleProseText, scientificSignature } from './paper-lib.mjs'

const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const nonempty = value => typeof value === 'string' && !!value.trim()
const timestamp = value => nonempty(value) && Number.isFinite(Date.parse(value))
const kinds = new Set(['heading', 'paragraph', 'figure', 'table', 'equation', 'reference', 'list', 'code', 'algorithm'])
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right))
const identityFacts = identity => Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'verifiedAt'))
const physicalIdentityFacts = identity => Object.fromEntries(Object.entries(identityFacts(identity)).filter(([key]) => key !== 'contextLength'))
const budgetKeys = ['maxTokens', 'batchSourceCharacters', 'maximumCharacters', 'maximumRecords', 'maximumUnitCharacters', 'maximumContextCharacters', 'maximumContextPerBlock', 'maximumSingleLongUnitContext']
const literalTransports = new Set(['opaque-think-delimiters-v1', 'opaque-model-delimiters-v2'])
const assistedCorrectionKeys = ['id', 'blockId', 'sourceId', 'method', 'assistingModel', 'assistingProvider', 'primaryModel', 'sourceSha256', 'sourceBlockSha256', 'draftSha256', 'instructionsSha256', 'appliedAt']
const fragmentCorrectionKeys = ['id', 'blockId', 'sourceId', 'method', 'assistingModel', 'assistingProvider', 'primaryModel', 'sourceSha256', 'sourceBlockSha256', 'draftSha256', 'previousChineseSha256', 'correctedChineseSha256', 'unitIds', 'appliedAt']

/** Reused responses may span model contexts; bind each unit to its actual run. */
export function assertLocalResponseReplay(paper, block) {
  const metadata = block.translation, replay = metadata?.responseReplay
  const correction = metadata?.assistedCorrection
  const corrected = correction?.method === 'codex-subagent-fragment-correction'
  const original = metadata?.originalTranslationMetadata
  if (corrected && (!original || !same(original.responseReplay, replay)
    || (original.translatedSha256 !== undefined && original.translatedSha256 !== correction.previousChineseSha256)
    || correction.correctedChineseSha256 !== sha256(block.zh))) {
    throw new Error(`Invalid corrected local response replay chain: ${paper.id}/${block.id}.`)
  }
  const units = translationUnits(block.en, block.kind).units
  const fail = () => { throw new Error(`Invalid local response replay provenance: ${paper.id}/${block.id}.`) }
  if (metadata?.provider !== 'LM Studio local API' || replay?.method !== 'validated-local-response-replay'
    || replay.sourcePaperSha256 !== paper.source.sha256 || replay.sourceBlockSha256 !== sha256(block.en)
    || replay.translatedBlockSha256 !== (corrected ? correction.previousChineseSha256 : sha256(block.zh)) || !timestamp(replay.assembledAt)
    || replay.assembledAt !== metadata.translatedAt || Date.parse(replay.assembledAt) > Date.parse(paper.translation.updatedAt)
    || !Array.isArray(replay.units) || replay.units.length !== units.length || !units.length) fail()
  replay.units.forEach((receipt, index) => {
    if (!record(receipt) || receipt.unitId !== index || receipt.sourceTextSha256 !== sha256(units[index].text)
      || !/^translation-response-[0-9-]+\.json$/.test(receipt.responseFile || '')
      || !fingerprint(receipt.responseSha256) || !fingerprint(receipt.promptSha256)
      || receipt.model !== metadata.model || receipt.provider !== 'LM Studio local API'
      || !validProviderIdentity(receipt.modelIdentity, receipt.model, receipt.provider)
      || !validLocalParameters(receipt.parameters) || !timestamp(receipt.requestRunStartedAt)) fail()
    const run = paper.translation.modelHistory?.find(run => run.model === receipt.model && run.provider === receipt.provider
      && run.startedAt === receipt.requestRunStartedAt && same(identityFacts(run.modelIdentity), identityFacts(receipt.modelIdentity)))
    // The translator adds at most two to its configured seed on a retry.
    if (!run || !same({ ...receipt.parameters, seed: run.parameters.seed }, run.parameters)
      || receipt.parameters.seed < run.parameters.seed || receipt.parameters.seed > run.parameters.seed + 2) fail()
  })
}

export function historicalBlockCounts(paper) {
  const counts = new Set([paper.blocks.length])
  for (const repair of paper.source.repairs || []) {
    if (repair.method !== 'separate-title-publication-notes-into-frontmatter') continue
    const added = paper.blocks.find(block => block.id === repair.addedBlockId)
    if (!Number.isSafeInteger(repair.previousBlockCount) || repair.previousBlockCount < 1
      || repair.previousBlockCount + 1 !== paper.blocks.length || repair.title !== paper.title
      || !added || added.kind !== 'paragraph' || added.sectionId !== 'frontmatter'
      || repair.notesSha256 !== sha256(added.en)) throw new Error(`Invalid title-note block revision: ${paper.id}.`)
    counts.add(repair.previousBlockCount)
  }
  return counts
}

function assertAssistedCorrections(paper) {
  const title = paper.translation.titleAssistedCorrection
  if (title && (title.method !== 'codex-subagent-title-correction' || title.model !== 'gpt-6-luna' || title.provider !== 'Codex subagent'
    || !same(title.parameters, { reasoning_effort: 'low' }) || title.primaryModel !== paper.translation.model
    || title.sourceTitleSha256 !== sha256(paper.title) || title.correctedChineseSha256 !== sha256(paper.titleZh)
    || !fingerprint(title.previousChineseSha256) || !fingerprint(title.draftSha256) || !fingerprint(title.reviewSha256)
    || !timestamp(title.appliedAt) || Date.parse(title.appliedAt) > Date.parse(paper.translation.updatedAt))) {
    throw new Error(`Invalid assisted title correction: ${paper.id}.`)
  }
  const ledger = paper.translation.assistedCorrections
  const assisted = paper.blocks.filter(block => block.translation?.assistedCorrection !== undefined)
  if (ledger === undefined && !assisted.length) return
  if (!Array.isArray(ledger)) throw new Error(`Missing or invalid assisted-correction ledger: ${paper.id}.`)
  const ids = new Set(), blockIds = new Set()
  for (const receipt of ledger) {
    const block = paper.blocks.find(candidate => candidate.id === receipt?.blockId)
    const metadata = block?.translation
    const fragments = receipt?.method === 'codex-subagent-fragment-correction'
    const keys = fragments ? fragmentCorrectionKeys : assistedCorrectionKeys
    if (!record(receipt) || Object.keys(receipt).length !== keys.length || !keys.every(key => Object.hasOwn(receipt, key))
      || !nonempty(receipt.id) || ids.has(receipt.id) || !nonempty(receipt.blockId) || blockIds.has(receipt.blockId)
      || !block || metadata?.status !== 'machine' || receipt.sourceId !== block.sourceId
      || !['model-retranslation-with-draft-reference', 'codex-subagent-fragment-correction'].includes(receipt.method)
      || receipt.assistingModel !== 'gpt-6-luna' || receipt.assistingProvider !== 'Codex subagent'
      || receipt.primaryModel !== metadata.model || (!fragments && receipt.primaryModel !== 'qwen3.6-35b-a3b')
      || receipt.sourceSha256 !== paper.source.sha256 || receipt.sourceBlockSha256 !== sha256(block.en)
      || !fingerprint(receipt.draftSha256)
      || !timestamp(receipt.appliedAt) || Date.parse(receipt.appliedAt) < Date.parse(metadata.translatedAt) || Date.parse(receipt.appliedAt) > Date.parse(paper.translation.updatedAt)
      || !same(receipt, metadata.assistedCorrection)) throw new Error(`Invalid assisted-correction receipt or counterpart: ${paper.id}/${receipt?.blockId || 'unknown'}.`)
    if (fragments) {
      const { units } = translationUnits(block.en, block.kind)
      if (!fingerprint(receipt.previousChineseSha256) || receipt.correctedChineseSha256 !== sha256(block.zh)
        || !Array.isArray(receipt.unitIds) || !receipt.unitIds.length
        || receipt.unitIds.some((index, position) => !Number.isSafeInteger(index) || index < 0 || index >= units.length
          || (position > 0 && index <= receipt.unitIds[position - 1]) || units[index]?.id !== String(index))) {
        throw new Error(`Invalid assisted-correction fragment hashes or source unit indices: ${paper.id}/${block.id}.`)
      }
    } else if (!fingerprint(receipt.instructionsSha256) || metadata.reviewCorrection?.method !== 'scoped-review-instructions'
      || metadata.reviewCorrection.instructionsSha256 !== receipt.instructionsSha256) {
      throw new Error(`Invalid assisted-correction review instructions: ${paper.id}/${block.id}.`)
    }
    ids.add(receipt.id)
    blockIds.add(receipt.blockId)
  }
  if (assisted.length !== ledger.length || assisted.some(block => !blockIds.has(block.id))) throw new Error(`Missing assisted-correction receipt counterpart: ${paper.id}.`)
}

function validBudget(budget, parameters) {
  return budget === undefined || (record(budget) && Object.keys(budget).length === budgetKeys.length
    && budgetKeys.every(key => Number.isSafeInteger(budget[key]) && budget[key] > 0) && budget.maxTokens === parameters.max_tokens)
}

function validLocalParameters(parameters) {
  return record(parameters) && Number.isFinite(parameters.temperature) && parameters.temperature >= 0 && parameters.temperature <= 2
    && Number.isFinite(parameters.top_p) && parameters.top_p > 0 && parameters.top_p <= 1
    && Number.isSafeInteger(parameters.max_tokens) && parameters.max_tokens > 0 && Number.isSafeInteger(parameters.seed)
    && parameters.reasoning_effort === 'none' && parameters.stream === false
}

function validParameters(parameters, provider, model) {
  return provider === 'Codex subagent'
    ? model === 'gpt-6-luna' && same(parameters, { reasoning_effort: 'low' })
    : validLocalParameters(parameters)
}

function validProviderIdentity(identity, model, provider) {
  return provider === 'Codex subagent' ? model === 'gpt-6-luna' && same(identity, { apiModelId: model }) : validIdentity(identity, model)
}

function validIdentity(identity, model) {
  return record(identity) && identity.apiModelId === model && (identity.verifiedAt === undefined || timestamp(identity.verifiedAt))
}

async function assertPublicFileAllowlist(root, files) {
  const directories = new Set([''])
  for (const relative of files.keys()) {
    let parent = path.posix.dirname(relative)
    while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent) }
  }
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name)
      if (entry.isDirectory() && directories.has(child)) await visit(child)
      else if (!entry.isFile() || !files.has(child)) throw new Error(`Unexpected public release file or directory: ${child}. Raw sources, debug responses and checkpoints must stay outside paper-data.`)
    }
  }
  await visit()
}

function assertSource(paper) {
  const source = paper.source
  if (!source || !fingerprint(source.sha256) || !timestamp(source.fetchedAt)) throw new Error(`Invalid source provenance metadata: ${paper.id}.`)
  const kind = source.kind || 'arxiv'
  if (kind === 'arxiv') {
    if (!validArxivId(paper.arxivId) || !/v\d+$/.test(paper.arxivId)
      || source.url !== `https://arxiv.org/abs/${paper.arxivId}` || source.htmlUrl !== `https://arxiv.org/html/${paper.arxivId}`) {
      throw new Error(`Invalid pinned arXiv provenance: ${paper.id}.`)
    }
  } else if (kind === 'official-article') {
    if (paper.id === 'muon-original-design') assertAuthorArticleProvenance(paper)
    else if (paper.arxivId !== null || source.url !== 'https://qwen.ai/blog?id=qwen3.5' || source.htmlUrl !== source.url
      || source.payloadUrl !== 'https://qwen.ai/api/v2/article/?language=en-US&path=qwen3.5&type=qwen_ai'
      || !timestamp(source.publishedAt) || source.language !== 'en-US') throw new Error(`Invalid official article provenance: ${paper.id}.`)
  } else if (kind === 'official-paper') {
    if (paper.arxivId !== null || source.format !== 'pdf') throw new Error(`Invalid official paper provenance: ${paper.id}.`)
  } else throw new Error(`Unsupported release source kind: ${kind}.`)
  if (source.format === 'pdf') assertPdfProvenance(paper)
}

function assertTranslationMetadata(paper) {
  const t = paper.translation
  const codexFallback = assertCodexFallbackReceipt(paper)
  if (t?.status !== 'machine' || !nonempty(paper.titleZh) || t.coverage?.complete !== paper.blocks.length || t.coverage?.total !== paper.blocks.length
    || paper.blocks.some(block => !nonempty(block.zh))) throw new Error(`Release translation incomplete: ${paper.id}.`)
  if (t.humanReviewed !== false) throw new Error(`Machine translation must remain marked humanReviewed=false: ${paper.id}.`)
  if (!nonempty(t.model) || !validProviderIdentity(t.modelIdentity, t.model, t.provider) || !nonempty(t.provider) || !nonempty(t.method)
    || !fingerprint(t.promptSha256) || !timestamp(t.createdAt) || !timestamp(t.updatedAt) || !timestamp(t.completedAt)
    || !validParameters(t.parameters, t.provider, t.model) || !validBudget(t.requestBudget, t.parameters)) throw new Error(`Invalid translation provenance metadata: ${paper.id}.`)
  if (t.literalTransport !== undefined && !literalTransports.has(t.literalTransport)) throw new Error(`Invalid recorded literal transport: ${paper.id}.`)

  // A declared history cannot supply API counters that Codex subagent runs do not expose.
  const codexHistory = Array.isArray(t.modelHistory) ? t.modelHistory.filter(run => run?.provider === 'Codex subagent') : []
  if ((!codexFallback && (t.provider === 'Codex subagent' || codexHistory.length) && (t.usage !== undefined || t.usageByModel !== undefined))
    || codexHistory.some(run => run.usage !== undefined || run.usageByModel !== undefined)) {
    throw new Error(`Codex translation cannot claim unobserved API token usage: ${paper.id}.`)
  }

  const declared = ['modelHistory', 'modelsUsed', 'modelIdentities', 'usageByModel'].some(key => t[key] !== undefined)
  if (!declared) return null
  if (!Array.isArray(t.modelsUsed) || !t.modelsUsed.length || !t.modelsUsed.every(nonempty)
    || new Set(t.modelsUsed).size !== t.modelsUsed.length || !t.modelsUsed.includes(t.model)
    || !Array.isArray(t.modelHistory) || !t.modelHistory.length || !record(t.modelIdentities) || !record(t.usageByModel)) {
    throw new Error(`Invalid declared model history: ${paper.id}.`)
  }
  const models = new Set(t.modelsUsed)
  const exactKeys = object => Object.keys(object).length === models.size && Object.keys(object).every(model => models.has(model))
  const usageModels = codexFallback
    ? new Set(t.modelHistory.filter(run => run.provider !== 'Codex subagent').map(run => run.model))
    : models
  const exactUsageKeys = Object.keys(t.usageByModel).length === usageModels.size && Object.keys(t.usageByModel).every(model => usageModels.has(model))
  if (!exactKeys(t.modelIdentities) || !exactUsageKeys) throw new Error(`Model identity or usage keys disagree with declared models: ${paper.id}.`)
  for (const model of models) {
    if (!validIdentity(t.modelIdentities[model], model)) throw new Error(`Invalid declared model identity: ${paper.id}/${model}.`)
    // A validated continuation receipt freezes the observed local API counters.
    // Codex subagent token usage remains unknown and has no invented zero entry.
    if (codexFallback && !usageModels.has(model)) continue
    const usage = t.usageByModel[model]
    const usageKeys = new Set(['promptTokens', 'completionTokens', 'observedReasoningTokens', 'reasoningUsageResponses'])
    if (!record(usage) || !Number.isSafeInteger(usage.promptTokens) || !Number.isSafeInteger(usage.completionTokens)
      || Object.entries(usage).some(([key, value]) => !usageKeys.has(key) || !Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid model token usage: ${paper.id}/${model}.`)
  }
  const summedUsage = { promptTokens: 0, completionTokens: 0 }
  for (const usage of Object.values(t.usageByModel)) for (const [key, value] of Object.entries(usage)) {
    summedUsage[key] = (summedUsage[key] || 0) + value
    if (!Number.isSafeInteger(summedUsage[key])) throw new Error(`Model token usage total exceeds safe integer range: ${paper.id}.`)
  }
  if (!same(t.usage, summedUsage)) throw new Error(`Aggregate token usage disagrees with model history: ${paper.id}.`)
  const historyModels = new Set()
  const blockCounts = historicalBlockCounts(paper)
  let previousStart = -Infinity
  for (const [index, entry] of t.modelHistory.entries()) {
    const start = Date.parse(entry?.startedAt)
    const previousModel = t.modelHistory[index - 1]?.model
    const coverage = entry?.coverageAtStart
    if (!record(entry) || !models.has(entry.model) || !validIdentity(entry.modelIdentity, entry.model)
      || !same(physicalIdentityFacts(entry.modelIdentity), physicalIdentityFacts(t.modelIdentities[entry.model]))
      || !nonempty(entry.provider) || !validProviderIdentity(entry.modelIdentity, entry.model, entry.provider)
      || !validParameters(entry.parameters, entry.provider, entry.model) || !validBudget(entry.requestBudget, entry.parameters) || !fingerprint(entry.promptSha256)
      || !timestamp(entry.startedAt) || start < previousStart
      || !['initial-model', 'legacy-provenance', 'resume-model', 'explicit-model-change'].includes(entry.reason)
      || !Number.isSafeInteger(coverage?.complete) || coverage.complete < 0 || coverage.complete > coverage.total || !blockCounts.has(coverage.total)
      || (!index && (!['initial-model', 'legacy-provenance'].includes(entry.reason) || entry.previousModel !== undefined))
      || (index > 0 && previousModel === entry.model && (entry.reason !== 'resume-model' || entry.previousModel !== undefined))
      || (index > 0 && previousModel !== entry.model && (entry.reason !== 'explicit-model-change' || entry.previousModel !== previousModel))) throw new Error(`Invalid model history entry: ${paper.id}.`)
    previousStart = start
    historyModels.add(entry.model)
  }
  if (historyModels.size !== models.size) throw new Error(`Declared model missing from history: ${paper.id}.`)
  for (const model of models) {
    const latest = t.modelHistory.findLast(entry => entry.model === model)
    if (!same(identityFacts(latest.modelIdentity), identityFacts(t.modelIdentities[model]))) throw new Error(`Latest model identity disagrees with history: ${paper.id}/${model}.`)
  }
  const active = t.modelHistory.at(-1)
  if (active.model !== t.model || active.provider !== t.provider || !same(active.parameters, t.parameters)
    || !same(active.requestBudget, t.requestBudget)
    || !same(identityFacts(active.modelIdentity), identityFacts(t.modelIdentity))
    || active.promptSha256 !== t.promptSha256) throw new Error(`Current translation run disagrees with model history: ${paper.id}.`)
  return t.modelHistory
}

/** Verify the public processed snapshot. This deliberately does not claim to re-hash excluded raw HTML. */
export async function verifyReleaseData({ dataDir = 'paper-data', report = value => console.log(JSON.stringify(value)) } = {}) {
  const { root, catalog, papers, files } = await inspectPublicData({ dataDir })
  const completePapers = papers.filter(({ paper }) => paper !== null)
  const sourceOnlyPapers = papers.length - completePapers.length
  if (!completePapers.length) throw new Error('Public release catalog must contain at least one complete document.')
  await assertPublicFileAllowlist(root, files)
  let blocks = 0, assets = 0
  for (const { entry, paper, metadata: publicMetadata, dataPath } of completePapers) {
    if (publicMetadata.content?.format !== 'html') throw new Error(`Public release requires standalone en.html/zh.html with body-free metadata: ${paper.id}.`)
    if (!nonempty(paper.title) || !Array.isArray(paper.authors) || !paper.authors.every(nonempty) || !publicationAuthors(paper)?.length
      || !Number.isInteger(paper.year) || paper.year < 1900 || paper.year > 2100 || !Array.isArray(paper.tags) || !paper.tags.every(nonempty)
      || !paper.blocks.length || !Array.isArray(paper.sections) || !paper.sections.length) throw new Error(`Invalid document metadata: ${paper.id}.`)
    assertSource(paper)
    assertChineseHeadingCompleteness(paper)
    sourceAssetMetadata(paper)
    const modelHistory = assertTranslationMetadata(paper)
    const sectionIds = new Set()
    for (const section of paper.sections) {
      if (!nonempty(section.id) || sectionIds.has(section.id) || !nonempty(section.title)
        || !Number.isInteger(section.level) || section.level < 1 || section.level > 6) throw new Error(`Invalid or duplicate section: ${paper.id}.`)
      sectionIds.add(section.id)
    }
    const blockIds = new Set(), referencedAssets = new Set()
    const sourceIds = { en: new Set(sectionIds), zh: new Set(sectionIds) }
    const references = { en: new Set(), zh: new Set() }
    for (const block of paper.blocks) {
      if (!nonempty(block.id) || blockIds.has(block.id) || !nonempty(block.sourceId) || !sectionIds.has(block.sectionId)
        || !kinds.has(block.kind) || !nonempty(block.en)) throw new Error(`Invalid release block: ${paper.id}/${block.id}.`)
      blockIds.add(block.id)
      const metadata = block.translation
      if (metadata?.literalTransport !== undefined && (metadata.status !== 'machine' || !literalTransports.has(metadata.literalTransport))) throw new Error(`Invalid recorded literal transport: ${paper.id}/${block.id}.`)
      if (block.zh.includes('⟪PAPERO_LITERAL_')) throw new Error(`Unrestored literal transport token: ${paper.id}/${block.id}.`)
      if (metadata?.responseChannels !== undefined && (!Array.isArray(metadata.responseChannels) || !metadata.responseChannels.length
        || new Set(metadata.responseChannels).size !== metadata.responseChannels.length
        || metadata.responseChannels.some(channel => !['content', 'reasoning_content'].includes(channel)))) {
        throw new Error(`Invalid recorded response channels: ${paper.id}/${block.id}.`)
      }
      if (metadata?.status === 'preserved') {
        if (block.zh !== block.en || metadata.model !== null) throw new Error(`Preserved block changed: ${paper.id}/${block.id}.`)
      } else if (metadata?.status !== 'machine' || (!modelHistory && metadata.model !== paper.translation.model)
        || metadata.sourceSha256 !== sha256(block.en) || !fingerprint(metadata.promptSha256) || !timestamp(metadata.translatedAt)) {
        throw new Error(`Missing or stale block translation provenance: ${paper.id}/${block.id}.`)
      }
      if (metadata?.status === 'machine' && (metadata.provider === 'Codex subagent' || (!modelHistory && paper.translation.provider === 'Codex subagent'))) {
        if (metadata.provider !== 'Codex subagent' || !validProviderIdentity(metadata.modelIdentity, metadata.model, metadata.provider)
          || !validParameters(metadata.parameters, metadata.provider, metadata.model) || !validBudget(metadata.requestBudget, metadata.parameters)
          || metadata.sourcePaperSha256 !== paper.source.sha256 || metadata.translatedSha256 !== sha256(block.zh)
          || ['usage', 'usageByModel', 'requestBudget'].some(key => metadata[key] !== undefined)
          || (!modelHistory && metadata.promptSha256 !== paper.translation.promptSha256)
          || Date.parse(metadata.translatedAt) < Date.parse(paper.translation.createdAt)
          || Date.parse(metadata.translatedAt) > Date.parse(paper.translation.updatedAt)) {
          throw new Error(`Invalid Codex block translation provenance: ${paper.id}/${block.id}.`)
        }
      }
      if (metadata?.status === 'machine' && modelHistory) {
        const replayed = metadata.responseReplay !== undefined
        if (replayed) assertLocalResponseReplay(paper, block)
        const translatedAt = Date.parse(metadata.translatedAt)
        const runs = modelHistory.filter((run, index) => run.model === metadata.model && (replayed || Date.parse(run.startedAt) <= translatedAt
          && (index === modelHistory.length - 1 || translatedAt < Date.parse(modelHistory[index + 1].startedAt))))
        if (!validProviderIdentity(metadata.modelIdentity, metadata.model, metadata.provider) || !validParameters(metadata.parameters, metadata.provider, metadata.model)
          || !validBudget(metadata.requestBudget, metadata.parameters)
          || !runs.some(run => (run.provider !== 'Codex subagent' || metadata.provider === run.provider)
            && same(identityFacts(metadata.modelIdentity), identityFacts(run.modelIdentity)) && same(metadata.parameters, run.parameters) && same(metadata.requestBudget, run.requestBudget))) {
          throw new Error(`Block model, identity, parameters or timestamp disagree with declared history: ${paper.id}/${block.id}.`)
        }
      }
      const languages = ['en', 'zh'].map(language => {
        const html = block[language]
        if (sanitizeHtml(html) !== html) throw new Error(`Unsafe or noncanonical HTML: ${paper.id}/${block.id}/${language}.`)
        const $ = load(html, {}, false)
        $('[id]').each((_, node) => sourceIds[language].add($(node).attr('id')))
        $('a[href^="#"]').each((_, node) => references[language].add($(node).attr('href').slice(1)))
        $('img').each((_, node) => {
          const src = $(node).attr('src')
          if (!/^assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(src ?? '')) throw new Error(`Invalid asset reference: ${paper.id}/${block.id}.`)
          referencedAssets.add(src.slice('assets/'.length))
        })
        return $
      })
      const anchors = $ => $('[id]').map((_, node) => $(node).attr('id')).get()
      if (JSON.stringify(anchors(languages[0])) !== JSON.stringify(anchors(languages[1]))) throw new Error(`Source HTML anchor changed: ${paper.id}/${block.id}.`)
      if (JSON.stringify(scientificSignature(languages[0])) !== JSON.stringify(scientificSignature(languages[1]))) throw new Error(`Equation, code, image or citation changed: ${paper.id}/${block.id}.`)
      try { assertTranslationFidelity(visibleProseText(languages[0]), visibleProseText(languages[1])) } catch (error) {
        throw new Error(`Release translation fidelity failed: ${paper.id}/${block.id}: ${error.message}`)
      }
    }
    assertAssistedCorrections(paper)
    for (const language of ['en', 'zh']) for (const reference of references[language]) {
      if (!sourceIds[language].has(reference)) throw new Error(`Broken internal reference: ${paper.id}/${language}/#${reference}.`)
    }
    if (referencedAssets.size !== paper.assets.length || paper.assets.some(asset => !referencedAssets.has(asset.filename))) throw new Error(`Asset metadata/reference count mismatch: ${paper.id}.`)
    for (const asset of paper.assets) {
      if (path.extname(asset.filename).toLowerCase() === '.svg') {
        const content = await readFile(path.join(root, path.dirname(dataPath), 'assets', asset.filename), 'utf8')
        if (asset.sanitized !== true || !fingerprint(asset.sourceSha256) || sanitizeSvg(content) !== content) throw new Error(`SVG sanitation provenance invalid: ${paper.id}/${asset.filename}.`)
      }
    }
    const expected = catalogEntry(paper)
    for (const [key, value] of Object.entries(expected)) {
      const actual = key === 'sourceKind' ? entry[key] || 'arxiv' : entry[key]
      if (JSON.stringify(actual) !== JSON.stringify(value)) throw new Error(`Catalog/document mismatch: ${paper.id}/${key}.`)
    }
    if (paper.statistics?.blockCount !== paper.blocks.length || paper.statistics?.sectionCount !== paper.sections.length) throw new Error(`Document statistics mismatch: ${paper.id}.`)
    blocks += paper.blocks.length; assets += paper.assets.length
  }
  const result = { papers: catalog.papers.length, blocks, assets, files: files.size, rawSourceVerified: false }
  if (sourceOnlyPapers) Object.assign(result, { sourceOnlyPapers, completePapers: completePapers.length })
  report({ type: 'public-release-verified', ...result })
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const args = process.argv.slice(2)
    if (args.includes('--help')) console.log('Usage: node scripts/verify-release-data.mjs [--data-dir paper-data]\nChecks complete processed public data, LFS hydration, provenance metadata, HTML/MathML/code, and all asset fingerprints. Excluded raw source HTML is not re-verified.')
    else {
      if (args.length && (args.length !== 2 || args[0] !== '--data-dir' || !args[1])) throw new Error('Unknown arguments; use --help.')
      await verifyReleaseData({ dataDir: args[1] || 'paper-data' })
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
