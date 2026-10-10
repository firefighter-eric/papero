import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { load } from 'cheerio'
import { assertTranslationFidelity, isTechnicalLabelOnly, normalizeHeadingNumber, safeId, sanitizeHtml, sha256, translationUnits, translatedAbstractText } from './paper-lib.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { updateCatalog } from './import-paper.mjs'

const MODEL = 'gpt-6-luna', PROVIDER = 'Codex subagent'
const PARAMETERS = { reasoning_effort: 'low' }, IDENTITY = { apiModelId: MODEL }
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && !!value.trim()
const timestamp = value => nonempty(value) && Number.isFinite(Date.parse(value))
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right))
const manifestHash = value => sha256(JSON.stringify(ordered(value)))
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

function sourceDocument(paper) {
  return { schemaVersion: paper.schemaVersion, id: paper.id, arxivId: paper.arxivId, title: paper.title,
    authors: paper.authors, year: paper.year, tags: paper.tags, abstract: paper.abstract, source: paper.source,
    sections: paper.sections.map(({ id, title, level }) => ({ id, title, level })),
    blocks: paper.blocks.map(({ id, sourceId, sectionId, kind, en }) => ({ id, sourceId, sectionId, kind, en })),
    statistics: paper.statistics, assets: paper.assets }
}

/** Freeze the exact original DOM text fragments before dispatching real Codex translation work. */
export function createCodexTranslationManifest(paper, { prompt, createdAt = new Date().toISOString() } = {}) {
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
    prompt, promptSha256: sha256(prompt), createdAt, blocks, jobs }
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
export async function applyCodexTranslations({ dataDir = process.env.DATA_DIR || 'data', id, manifest, drafts } = {}) {
  if (!safeId(id)) throw new Error('Invalid paper id')
  if (!Array.isArray(drafts) || !drafts.length) throw new Error('At least one Codex draft is required')
  return withExclusivePaperLock(dataDir, id, async () => {
    const filename = path.join(dataDir, 'papers', id, 'paper.json')
    const paper = JSON.parse(await readFile(filename, 'utf8'))
    if (paper.id !== id || manifest?.paperId !== id) throw new Error('Codex manifest paper id mismatch')
    const expected = createCodexTranslationManifest(paper, { prompt: manifest.prompt, createdAt: manifest.createdAt })
    if (!same(manifest, expected)) throw new Error('Frozen Codex manifest or source document mismatch; original source drifted or a fingerprint changed')
    const previous = paper.translation || {}
    if (previous.model && previous.model !== MODEL) throw new Error('Codex primary translation cannot replace another model run')
    if (['modelHistory', 'modelsUsed', 'modelIdentities', 'usageByModel', 'usage', 'requestBudget'].some(key => previous[key] !== undefined)) {
      throw new Error('Codex primary translation cannot invent or replace API usage, budgets or declared model history')
    }
    if (previous.model) assertRun(previous, manifest.promptSha256)
    if (previous.model && (previous.manifestSha256 !== manifestHash(manifest) || previous.sourceSha256 !== paper.source.sha256)) throw new Error('Codex continuation manifest changed')
    if (paper.titleZh && (!previous.model || previous.titleTranslatedSha256 !== sha256(paper.titleZh))) throw new Error('Existing Codex title translation changed or lacks observed provenance')
    for (const block of paper.blocks.filter(block => block.zh)) {
      if (block.translation?.status === 'preserved' && block.zh === block.en && block.translation.model === null) continue
      assertRun(block.translation || {}, manifest.promptSha256)
      if (block.translation.status !== 'machine' || block.translation.sourceSha256 !== sha256(block.en)
        || block.translation.translatedSha256 !== sha256(block.zh)) throw new Error('Existing Codex translation provenance is stale')
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
    if (paper.translation.status === 'machine') paper.translation.completedAt = now
    else delete paper.translation.completedAt
    if (paper.titleZh) paper.translation.titleTranslatedSha256 = sha256(paper.titleZh)
    paper.abstractZh = translatedAbstractText(paper.blocks)
    const temporary = `${filename}.${randomUUID()}.tmp`
    try { await writeFile(temporary, JSON.stringify(paper, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, filename) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    await updateCatalog(dataDir, paper)
    return paper
  })
}
