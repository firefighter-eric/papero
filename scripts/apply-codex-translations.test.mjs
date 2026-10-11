import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { load } from 'cheerio'
import { applyCodexTranslations, assertCodexFallbackReceipt, createCodexTranslationManifest } from './apply-codex-translations.mjs'
import { catalogEntry, sanitizeHtml, sha256 } from './paper-lib.mjs'
import { prepareData } from './prepare-data.mjs'
import { verifyReleaseData } from './verify-release-data.mjs'

const date = '2026-01-01T00:00:00.000Z', translatedAt = '2026-01-01T00:01:00.000Z'
const prompt = 'Synthetic test instructions: translate exact English DOM fragments into Simplified Chinese; preserve source identifiers, quantities and immutable markup.'
const translations = {
  '__title:0': '合成测试报告', 'block-001:0': ' 引言',
  'block-002:0': '模型使用 2 层。 ', 'block-002:1': '参见引言。',
  'block-003:0': '我们保留完整的原始描述，并使用 8 个训练批次来评估该模型，且评估期间的设置保持不变。',
}

function paperFixture() {
  const blocks = [
    { id: 'block-001', sourceId: 'intro', sectionId: 'intro', kind: 'heading', en: sanitizeHtml('<h2 id="intro"><span class="ltx_tag">1.</span> Introduction</h2>'), zh: null },
    { id: 'block-002', sourceId: 'narrative', sectionId: 'intro', kind: 'paragraph', en: sanitizeHtml('<p id="narrative">The model uses 2 layers. <math><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow></math> <code>const count = 2;</code> <a href="#intro">See the introduction.</a></p>'), zh: null },
    { id: 'block-003', sourceId: 'evaluation', sectionId: 'intro', kind: 'paragraph', en: sanitizeHtml('<p id="evaluation">We retain the complete original description and evaluate the model using 8 training batches while keeping the settings unchanged during evaluation.</p>'), zh: null },
    { id: 'block-004', sourceId: 'equation', sectionId: 'intro', kind: 'equation', en: sanitizeHtml('<math display="block"><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow></math>'), zh: null },
  ]
  return { schemaVersion: 1, id: 'synthetic-report', arxivId: '2401.00001v1', title: 'Synthetic Test Report', titleZh: null,
    authors: ['Test Author'], year: 2024, tags: ['Testing'], abstract: '', abstractZh: '',
    source: { kind: 'arxiv', url: 'https://arxiv.org/abs/2401.00001v1', htmlUrl: 'https://arxiv.org/html/2401.00001v1', sha256: sha256('synthetic excluded raw source'), fetchedAt: date },
    translation: { status: 'pending', model: null, humanReviewed: false, coverage: { complete: 0, total: blocks.length } },
    sections: [{ id: 'intro', title: 'Introduction', level: 2 }], blocks,
    statistics: { blockCount: blocks.length, sectionCount: 1 }, assets: [] }
}

const otherEntry = { access: 'source-only', id: 'other-report', arxivId: '2601.00001v1', sourceKind: 'arxiv', title: 'Other Report', titleZh: null,
  authors: ['Other Author'], year: 2026, tags: ['Testing'], sourceUrl: 'https://arxiv.org/abs/2601.00001v1', sourceHtmlUrl: 'https://arxiv.org/html/2601.00001v1',
  dataPath: null, blockCount: 0, sectionCount: 0, translationStatus: 'pending', abstract: '', abstractZh: '' }

async function fixture(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-codex-primary-'))
  const dataDir = path.join(directory, 'input'), paper = paperFixture(), paperDir = path.join(dataDir, 'papers', paper.id)
  const filename = path.join(paperDir, 'paper.json'), catalogFile = path.join(dataDir, 'catalog.json')
  await mkdir(paperDir, { recursive: true })
  const save = async value => writeFile(filename, JSON.stringify(value))
  await save(paper)
  await writeFile(catalogFile, JSON.stringify({ schemaVersion: 1, papers: [catalogEntry(paper), otherEntry] }))
  const manifest = createCodexTranslationManifest(paper, { prompt, createdAt: date })
  const draft = (jobIds = manifest.jobs.map(job => job.id)) => ({ jobIds, translations: Object.fromEntries(jobIds.map(id => [id, translations[id]])),
    model: manifest.model, provider: manifest.provider, parameters: structuredClone(manifest.parameters), modelIdentity: structuredClone(manifest.modelIdentity),
    promptSha256: manifest.promptSha256, translatedAt })
  const apply = drafts => applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts })
  try { await action({ directory, dataDir, paper, filename, catalogFile, manifest, draft, apply, save }) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('frozen manifest binds exact paper source identity, metadata, DOM fragments and job hashes', async () => {
  await fixture(async ({ paper, manifest }) => {
    assert.equal(manifest.sourceSha256, paper.source.sha256)
    assert.equal(manifest.promptSha256, sha256(prompt))
    assert.equal(manifest.titleSha256, sha256(paper.title))
    assert.deepEqual(manifest.modelIdentity, { apiModelId: 'gpt-6-luna' })
    assert.deepEqual(manifest.parameters, { reasoning_effort: 'low' })
    for (const job of manifest.jobs) assert.equal(job.sourceTextSha256, sha256(job.text))
    assert.deepEqual(manifest.blocks[1].unitIds, ['block-002:0', 'block-002:1'])
    assert.deepEqual(manifest.blocks[3].unitIds, [])
    assert.throws(() => createCodexTranslationManifest(paper, { prompt: '' }), /Invalid/)
  })
})

test('whole-block checkpoints resume to complete release while preserving source DOM and another catalog entry', async () => {
  await fixture(async ({ directory, dataDir, filename, catalogFile, paper, manifest, draft, apply }) => {
    const first = await apply([draft(['__title:0', 'block-001:0'])])
    assert.equal(first.translation.status, 'pending')
    assert.equal(first.translation.humanReviewed, false)
    assert.deepEqual(first.translation.coverage, { complete: 2, total: 4 })
    assert.deepEqual(first.blocks[3].translation, { status: 'preserved', model: null })
    assert.equal(first.blocks[1].zh, null)
    assert.equal(first.translation.usage, undefined)
    assert.equal(first.translation.modelHistory, undefined)
    assert.equal(first.translation.requestBudget, undefined)
    let exported = await prepareData({ dataDir, outDir: path.join(directory, 'partial'), include: true })
    await assert.rejects(verifyReleaseData({ dataDir: exported.output, report: () => {} }), /translation incomplete/)
    const firstAccepted = structuredClone(first.blocks[0])
    const second = await apply([draft(['block-002:0', 'block-002:1']), draft(['block-003:0'])])
    assert.equal(second.translation.status, 'machine')
    assert.deepEqual(second.translation.coverage, { complete: 4, total: 4 })
    assert.deepEqual(second.blocks[0], firstAccepted)
    assert.deepEqual(second.blocks.map(block => block.en), paper.blocks.map(block => block.en))
    const signature = html => {
      const $ = load(html, {}, false)
      return $('math,code,a,[id]').map((_, node) => ['math', 'code'].includes(node.name) ? $.html(node)
        : [node.name, $(node).attr('id'), $(node).attr('href')].join(':')).get()
    }
    assert.deepEqual(signature(second.blocks[1].zh), signature(paper.blocks[1].en))
    assert.equal(second.sections[0].titleZh, '1. 引言')
    assert.equal(second.blocks[1].translation.promptSha256, manifest.promptSha256)
    assert.equal(second.blocks[1].translation.sourceSha256, sha256(paper.blocks[1].en))
    assert.equal(second.blocks[1].translation.sourcePaperSha256, paper.source.sha256)
    assert.equal(second.blocks[1].translation.translatedAt, translatedAt)
    assert.deepEqual(JSON.parse(await readFile(catalogFile, 'utf8')).papers[1], otherEntry)
    assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), second)
    exported = await prepareData({ dataDir, outDir: path.join(directory, 'complete'), include: true })
    assert.equal((await verifyReleaseData({ dataDir: exported.output, report: () => {} })).completePapers, 1)
  })
})

test('unknown model, fabricated API settings, identity, prompt hash, timestamps and usage fields reject without writes', async () => {
  await fixture(async ({ filename, catalogFile, draft, apply }) => {
    const before = await readFile(filename, 'utf8'), catalogBefore = await readFile(catalogFile, 'utf8')
    for (const mutate of [
      value => { value.model = 'gpt-6-sol' }, value => { value.provider = 'LM Studio local API' },
      value => { value.parameters.temperature = 0.1 }, value => { value.parameters.reasoning_effort = 'none' },
      value => { value.modelIdentity = { apiModelId: 'unknown-model' } }, value => { value.promptSha256 = 'a'.repeat(64) },
      value => { value.translatedAt = 'invalid' }, value => { value.translatedAt = '2025-01-01T00:00:00.000Z' },
      value => { value.usage = { promptTokens: 0, completionTokens: 0 } },
    ]) {
      const value = draft(); mutate(value)
      await assert.rejects(apply([value]), /mismatch|timestamp|fields/)
      assert.equal(await readFile(filename, 'utf8'), before)
      assert.equal(await readFile(catalogFile, 'utf8'), catalogBefore)
    }
  })
})

test('missing, extra, duplicate and unknown IDs cannot create half a block or silently combine units', async () => {
  await fixture(async ({ filename, draft, apply }) => {
    const before = await readFile(filename, 'utf8')
    const missing = draft(); delete missing.translations['block-002:1']
    const extra = draft(); extra.translations['invented:0'] = '虚构片段'
    const unknown = draft(); unknown.jobIds.push('invented:0'); unknown.translations['invented:0'] = '虚构片段'
    const duplicate = draft(); duplicate.jobIds.push('block-002:0')
    for (const drafts of [[missing], [extra], [unknown], [duplicate], [draft(['block-002:0'])], [draft(), draft(['block-002:0'])]]) {
      await assert.rejects(apply(drafts), /IDs|job ID|Missing/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
  })
})

test('wrong manifest hashes and source identity, title, metadata or DOM drift reject before mutation', async () => {
  await fixture(async ({ filename, paper, manifest, draft, dataDir, save }) => {
    for (const mutate of [
      value => { value.sourceSha256 = 'b'.repeat(64) }, value => { value.titleSha256 = 'c'.repeat(64) },
      value => { value.blocks[1].sourceBlockSha256 = 'd'.repeat(64) },
      value => { value.jobs[0].sourceTextSha256 = 'e'.repeat(64) }, value => { value.jobs[0].text = 'Invented title' },
      value => { value.parameters.reasoning_effort = 'high' },
    ]) {
      const changed = structuredClone(manifest); mutate(changed)
      const before = await readFile(filename, 'utf8')
      await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest: changed, drafts: [draft()] }), /Frozen/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
    for (const mutate of [
      value => { value.source.url += '?changed=1' }, value => { value.title += ' drift' },
      value => { value.authors.push('New Author') }, value => { value.sections[0].title = 'New section' },
      value => { value.blocks[1].en = value.blocks[1].en.replace('layers', 'heads') },
      value => { value.blocks[1].sourceId = 'changed-anchor' }, value => { value.assets.push({ filename: 'invented.png' }) },
    ]) {
      const changed = structuredClone(paper); mutate(changed); await save(changed)
      const before = await readFile(filename, 'utf8')
      await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [draft()] }), /Frozen/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
  })
})

test('changed quantities and untranslated prose fail fidelity while accepted blocks cannot be overwritten', async () => {
  await fixture(async ({ filename, draft, apply }) => {
    const before = await readFile(filename, 'utf8')
    const numbers = draft(); numbers.translations['block-002:0'] = '模型使用 3 层。 '
    await assert.rejects(apply([numbers]), /fidelity.*Numeric/s)
    const english = draft(); english.translations['block-003:0'] = paperFixture().blocks[2].en.replace(/<[^>]+>/g, '')
    await assert.rejects(apply([english]), /No Chinese/)
    assert.equal(await readFile(filename, 'utf8'), before)
    await apply([draft(['block-002:0', 'block-002:1'])])
    const checkpoint = await readFile(filename, 'utf8')
    await assert.rejects(apply([draft(['block-002:0', 'block-002:1'])]), /replace an accepted/)
    assert.equal(await readFile(filename, 'utf8'), checkpoint)
  })
})

test('primary translator refuses replacement of other model provenance and unknown API history', async () => {
  await fixture(async ({ paper, save, filename, draft, apply }) => {
    for (const metadata of [{ model: 'qwen3.6-35b-a3b' }, { usage: { promptTokens: 0, completionTokens: 0 } }, { modelHistory: [] }]) {
      await save({ ...paper, translation: { ...paper.translation, ...metadata } })
      const before = await readFile(filename, 'utf8')
      await assert.rejects(apply([draft()]), /another model run|invent or replace/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
  })
})

test('continuation rejects changed accepted Chinese bodies and titles while retaining checkpoints', async () => {
  await fixture(async ({ filename, draft, apply, save }) => {
    const first = await apply([draft(['__title:0', 'block-001:0'])])
    for (const mutate of [value => { value.blocks[0].zh += '额外内容' }, value => { value.titleZh += '额外内容' },
      value => { value.translation.manifestSha256 = 'a'.repeat(64) }]) {
      const changed = structuredClone(first); mutate(changed); await save(changed)
      const before = await readFile(filename, 'utf8')
      await assert.rejects(apply([draft(['block-002:0', 'block-002:1'])]), /stale|title translation changed|manifest changed/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
  })
})

test('strict release checks Codex model, exact observed parameters and identity for paper and each block', async () => {
  await fixture(async ({ directory, dataDir, draft, apply, save }) => {
    const complete = await apply([draft()])
    const check = async value => {
      await save(value)
      const exported = await prepareData({ dataDir, outDir: path.join(directory, 'validation'), include: true })
      return verifyReleaseData({ dataDir: exported.output, report: () => {} })
    }
    await check(complete)
    for (const mutate of [
      value => { value.translation.model = 'unknown-model' },
      value => { value.translation.parameters.temperature = 0.1 },
      value => { value.translation.modelIdentity.quantization = 'unknown' },
      value => { value.translation.usage = { promptTokens: 0, completionTokens: 0 } },
      value => { value.blocks[1].translation.model = 'unknown-model' },
      value => { value.blocks[1].translation.parameters.reasoning_effort = 'none' },
      value => { value.blocks[1].translation.modelIdentity.apiModelId = 'gpt-6-sol' },
      value => { delete value.blocks[1].translation.provider },
      value => { value.blocks[1].translation.promptSha256 = 'f'.repeat(64) },
      value => { value.blocks[1].translation.sourcePaperSha256 = 'f'.repeat(64) },
      value => { value.blocks[1].translation.translatedSha256 = 'f'.repeat(64) },
      value => { value.blocks[1].translation.usage = { promptTokens: 0, completionTokens: 0 } },
      value => { value.blocks[1].translation.usageByModel = { 'gpt-6-luna': { promptTokens: 0, completionTokens: 0 } } },
    ]) {
      const changed = structuredClone(complete); mutate(changed)
      await assert.rejects(check(changed), /provenance|unobserved API token usage/)
    }
  })
})

test('declared Codex histories reject unobserved API usage, including zero values and earlier Codex runs', async () => {
  await fixture(async ({ directory, dataDir, manifest, draft, apply, save }) => {
    const complete = await apply([draft()]), model = manifest.model
    const history = { model, modelIdentity: manifest.modelIdentity, provider: manifest.provider, parameters: manifest.parameters,
      promptSha256: manifest.promptSha256, startedAt: date, reason: 'initial-model', coverageAtStart: { complete: 0, total: complete.blocks.length } }
    const check = async value => {
      await save(value)
      const exported = await prepareData({ dataDir, outDir: path.join(directory, 'history'), include: true })
      return verifyReleaseData({ dataDir: exported.output, report: () => {} })
    }
    await check(complete)
    for (const tokens of [{ promptTokens: 12, completionTokens: 7 }, { promptTokens: 0, completionTokens: 0 }]) {
      const changed = structuredClone(complete)
      changed.translation = { ...changed.translation, modelsUsed: [model], modelIdentities: { [model]: manifest.modelIdentity },
        modelHistory: [history], usageByModel: { [model]: tokens }, usage: tokens }
      await assert.rejects(check(changed), /unobserved API token usage/)
      delete changed.translation.usage
      await assert.rejects(check(changed), /unobserved API token usage/)
    }
    const localModel = 'qwen3.6-35b-a3b', localProvider = 'LM Studio local API'
    const localParameters = { temperature: 0.1, top_p: 0.9, max_tokens: 1024, seed: 42, reasoning_effort: 'none', stream: false }
    const localIdentity = { apiModelId: localModel }
    const changed = structuredClone(complete)
    changed.translation = { ...changed.translation, model: localModel, provider: localProvider, parameters: localParameters,
      modelIdentity: localIdentity, modelsUsed: [model, localModel], modelIdentities: { [model]: manifest.modelIdentity, [localModel]: localIdentity },
      modelHistory: [history, { ...history, model: localModel, provider: localProvider, parameters: localParameters,
        modelIdentity: localIdentity, startedAt: '2026-01-01T00:02:00.000Z', reason: 'explicit-model-change', previousModel: model }],
      usageByModel: { [model]: { promptTokens: 0, completionTokens: 0 }, [localModel]: { promptTokens: 10, completionTokens: 5 } },
      usage: { promptTokens: 10, completionTokens: 5 } }
    await assert.rejects(check(changed), /unobserved API token usage/)
    delete changed.translation.usage
    delete changed.translation.usageByModel
    for (const key of ['usage', 'usageByModel']) {
      changed.translation.modelHistory[0][key] = { promptTokens: 0, completionTokens: 0 }
      await assert.rejects(check(changed), /unobserved API token usage/)
      delete changed.translation.modelHistory[0][key]
    }
  })
})

const fallbackAt = '2026-01-01T00:04:00.000Z', fallbackTranslatedAt = '2026-01-01T00:05:00.000Z'
function qwenCheckpoint(paper) {
  const localModel = 'qwen3.6-35b-a3b', provider = 'LM Studio local API'
  const identity = { apiModelId: localModel, displayName: 'Qwen3.6 35B A3B', publisher: 'mlx-community', format: 'mlx',
    quantization: '4bit', parameters: '35B', architecture: 'qwen3_5_moe', installedModelKey: localModel,
    contextLength: 8192, sizeBytes: 20429166969, verifiedAt: date }
  const parameters = { temperature: 0.1, top_p: 0.9, max_tokens: 4096, seed: 42, reasoning_effort: 'none', stream: false }
  const requestBudget = { maxTokens: 4096, batchSourceCharacters: 3000, maximumCharacters: 3000, maximumRecords: 40,
    maximumUnitCharacters: 6000, maximumContextCharacters: 1200, maximumContextPerBlock: 1200, maximumSingleLongUnitContext: 300 }
  const initialPrompt = sha256('observed synthetic initial LM Studio prompt'), resumedPrompt = sha256('observed synthetic resumed LM Studio prompt')
  const history = { model: localModel, provider, modelIdentity: identity, parameters, requestBudget,
    promptSha256: initialPrompt, startedAt: date, reason: 'initial-model', coverageAtStart: { complete: 0, total: 4 } }
  const resumedIdentity = { ...identity, verifiedAt: '2026-01-01T00:02:00.000Z' }
  const changed = structuredClone(paper)
  changed.titleZh = 'Qwen 已接受的合成测试标题'
  changed.blocks[0].zh = changed.blocks[0].en.replace('Introduction', '引言')
  changed.blocks[0].translation = { status: 'machine', model: localModel, provider, modelIdentity: structuredClone(identity),
    parameters: structuredClone(parameters), requestBudget: structuredClone(requestBudget), sourceSha256: sha256(changed.blocks[0].en),
    promptSha256: initialPrompt, translatedAt, responseChannels: ['reasoning_content'],
    corrections: { method: 'isolated-fragment-retranslation', unitIds: ['block-001:0'], promptSha256: sha256('observed synthetic correction') } }
  changed.blocks[3].zh = changed.blocks[3].en
  changed.blocks[3].translation = { status: 'preserved', model: null }
  changed.sections[0].titleZh = '1. 引言'
  const usage = { promptTokens: 123, completionTokens: 45, observedReasoningTokens: 0, reasoningUsageResponses: 1 }
  changed.translation = { status: 'pending', model: localModel, provider, humanReviewed: false, method: 'Observed synthetic LM Studio fragment translation',
    parameters, modelIdentity: resumedIdentity, requestBudget, promptSha256: resumedPrompt, createdAt: date, updatedAt: '2026-01-01T00:03:00.000Z',
    coverage: { complete: 2, total: 4 }, modelsUsed: [localModel], modelIdentities: { [localModel]: resumedIdentity },
    usage, usageByModel: { [localModel]: structuredClone(usage) }, modelHistory: [history,
      { ...structuredClone(history), modelIdentity: resumedIdentity, promptSha256: resumedPrompt, startedAt: resumedIdentity.verifiedAt,
        reason: 'resume-model', coverageAtStart: { complete: 2, total: 4 } }],
    concurrency: 4, literalTransport: 'opaque-model-delimiters-v2', correctionPromptSha256: sha256('observed synthetic isolated prompt'),
    retryPolicy: { attemptsPerRequest: 3, seeds: [42, 43, 44], splitFailedRequests: true } }
  return changed
}

test('explicit fallback freezes real Qwen contributions and resumes Luna without inventing Luna API usage', async () => {
  await fixture(async ({ directory, dataDir, paper, save, draft }) => {
    const local = qwenCheckpoint(paper)
    const unused = Buffer.from('unused synthetic image source')
    await mkdir(path.join(dataDir, 'papers', paper.id, 'assets'))
    await writeFile(path.join(dataDir, 'papers', paper.id, 'assets', 'unused.png'), unused)
    local.assets = [{ filename: 'unused.png', sourceUrl: 'https://arxiv.org/html/2401.00001v1/unused.png', sha256: sha256(unused), bytes: unused.length }]
    await save(local)
    const manifest = createCodexTranslationManifest(local, { prompt, createdAt: fallbackAt, allowModelChange: true })
    const fallbackDraft = ids => ({ ...draft(ids), promptSha256: manifest.promptSha256, translatedAt: fallbackTranslatedAt })
    const first = await applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [fallbackDraft(['block-002:0', 'block-002:1'])], allowModelChange: true })
    const receipt = assertCodexFallbackReceipt(first)
    assert.deepEqual(receipt.baseline.translation, local.translation)
    assert.equal(JSON.stringify(first.blocks[0]), JSON.stringify(local.blocks[0]))
    assert.equal(JSON.stringify(first.blocks[3]), JSON.stringify(local.blocks[3]))
    for (const key of ['usage', 'usageByModel']) assert.equal(JSON.stringify(first.translation[key]), JSON.stringify(local.translation[key]))
    assert.equal(JSON.stringify(first.translation.modelHistory.slice(0, -1)), JSON.stringify(local.translation.modelHistory))
    assert.deepEqual(first.translation.modelIdentities['qwen3.6-35b-a3b'], local.translation.modelIdentity)
    assert.equal(first.titleZh, local.titleZh)
    assert.deepEqual(first.translation.titleTranslation, { model: 'qwen3.6-35b-a3b', provider: 'LM Studio local API',
      sourceSha256: sha256(local.title), translatedSha256: sha256(local.titleZh) })
    assert.equal(first.translation.usageScope, 'observed-api-models-only')
    assert.equal(first.translation.requestBudget, undefined)
    for (const key of ['literalTransport', 'correctionPromptSha256', 'concurrency', 'retryPolicy']) {
      assert.equal(first.translation[key], undefined)
      assert.deepEqual(receipt.baseline.translation[key], local.translation[key])
    }
    assert.equal(first.translation.usageByModel['gpt-6-luna'], undefined)
    assert.equal(first.translation.modelHistory.at(-1).usage, undefined)
    assert.equal(first.translation.modelHistory.at(-1).requestBudget, undefined)
    assert.deepEqual(first.translation.modelsUsed, ['qwen3.6-35b-a3b', 'gpt-6-luna'])
    assert.deepEqual(createCodexTranslationManifest(first, { prompt, createdAt: fallbackAt }), manifest)
    // Explicit authorization is frozen in the receipt; continuation of that
    // exact Luna manifest does not need to relabel or replace the original API run.
    const second = await applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [fallbackDraft(['block-003:0'])] })
    assert.equal(second.translation.status, 'machine')
    assert.deepEqual(second.translation.coverage, { complete: 4, total: 4 })
    assert.equal(second.translation.modelHistory.length, local.translation.modelHistory.length + 1)
    assert.deepEqual(second.translation.codexFallback, receipt)
    assert.equal(JSON.stringify(second.blocks[0]), JSON.stringify(local.blocks[0]))
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'mixed'), include: true })
    assert.equal((await verifyReleaseData({ dataDir: exported.output, report: () => {} })).completePapers, 1)
    const published = JSON.parse(await readFile(path.join(exported.output, 'papers', paper.id, 'paper.json')))
    assert.deepEqual(published.assets, [])
    assert.deepEqual(published.publicationSourceAssets, local.assets)
    assert.deepEqual(published.translation.codexFallback, receipt)
  })
})

test('fallback remains opt-in and refuses unknown or inconsistent existing Qwen API provenance', async () => {
  await fixture(async ({ dataDir, filename, paper, save, draft }) => {
    const local = qwenCheckpoint(paper); await save(local)
    const options = { prompt, createdAt: fallbackAt, allowModelChange: true }
    const manifest = createCodexTranslationManifest(local, options)
    const drafts = [{ ...draft(['block-003:0']), translatedAt: fallbackTranslatedAt }]
    await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts }), /another model run/)
    for (const mutate of [
      value => { value.translation.model = 'qwen3.8-27b-splash' },
      value => { value.translation.provider = 'Codex subagent' },
      value => { value.translation.modelIdentity.architecture = 'unknown' },
      value => { value.translation.usageByModel['gpt-6-luna'] = { promptTokens: 0, completionTokens: 0 } },
      value => { value.translation.usage.promptTokens++ },
      value => { value.translation.modelHistory[0].provider = 'fake API' },
      value => { value.translation.modelHistory[0].parameters.seed++ },
      value => { value.blocks[0].translation.provider = 'fake API' },
      value => { value.blocks[0].translation.modelIdentity.apiModelId = 'unknown' },
      value => { value.blocks[0].translation.sourceSha256 = 'f'.repeat(64) },
      value => { value.blocks[0].translation.status = 'preserved' },
      value => { value.blocks[0].translation.parameters.temperature = 0.9 },
      value => { value.blocks[0].translation.translatedAt = '2025-01-01T00:00:00.000Z' },
    ]) {
      const changed = structuredClone(local); mutate(changed); await save(changed)
      const before = await readFile(filename, 'utf8')
      assert.throws(() => createCodexTranslationManifest(changed, options), /Qwen fallback provenance/)
      await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts, allowModelChange: true }), /Qwen fallback provenance/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
  })
})

test('assisted correction preserves frozen Qwen history and exports only the corrected HTML', async () => {
  await fixture(async ({ directory, dataDir, paper, save, draft }) => {
    const local = qwenCheckpoint(paper); await save(local)
    const manifest = createCodexTranslationManifest(local, { prompt, createdAt: fallbackAt, allowModelChange: true })
    const completed = await applyCodexTranslations({ dataDir, id: paper.id, manifest,
      drafts: [{ ...draft(['block-002:0', 'block-002:1', 'block-003:0']), translatedAt: fallbackTranslatedAt }], allowModelChange: true })
    const baseline = structuredClone(completed.translation.codexFallback)
    const block = completed.blocks[0], original = structuredClone(block.translation), previous = block.zh
    block.zh = block.zh.replace('引言', '引言部分')
    completed.sections[0].titleZh = '1. 引言部分'
    const receipt = { id: 'synthetic-observed-assistance', blockId: block.id, sourceId: block.sourceId,
      method: 'codex-subagent-fragment-correction', assistingModel: 'gpt-6-luna', assistingProvider: 'Codex subagent',
      primaryModel: original.model, sourceSha256: completed.source.sha256, sourceBlockSha256: sha256(block.en),
      draftSha256: sha256('synthetic test correction draft'), previousChineseSha256: sha256(previous),
      correctedChineseSha256: sha256(block.zh), unitIds: [0], appliedAt: '2026-01-01T00:06:00.000Z' }
    block.translation = { ...original, originalTranslationMetadata: original, translatedSha256: sha256(block.zh), assistedCorrection: receipt }
    completed.translation.assistedCorrections = [structuredClone(receipt)]
    completed.translation.updatedAt = receipt.appliedAt
    assert.deepEqual(assertCodexFallbackReceipt(completed), baseline)
    assert.deepEqual(createCodexTranslationManifest(completed, { prompt, createdAt: fallbackAt }), manifest)
    assert.deepEqual(completed.translation.usage, local.translation.usage)
    assert.deepEqual(completed.translation.modelHistory.slice(0, -1), local.translation.modelHistory)
    await save(completed)
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'corrected'), include: true })
    assert.equal((await verifyReleaseData({ dataDir: exported.output, report: () => {} })).completePapers, 1)
    const html = await readFile(path.join(exported.output, 'papers', paper.id, 'zh.html'), 'utf8')
    assert.match(html, /引言部分/)
    for (const mutate of [
      value => { value.blocks[0].translation.originalTranslationMetadata.parameters.seed++ },
      value => { value.blocks[0].translation.parameters.seed++ },
      value => { value.blocks[0].translation.assistedCorrection.previousChineseSha256 = 'f'.repeat(64) },
      value => { value.blocks[0].translation.assistedCorrection.correctedChineseSha256 = 'f'.repeat(64) },
      value => { value.blocks[0].translation.assistedCorrection.sourceBlockSha256 = 'f'.repeat(64) },
      value => { value.blocks[0].translation.assistedCorrection.unitIds = [100] },
      value => { value.blocks[0].translation.assistedCorrection.unitIds = [0, 0] },
      value => { value.blocks[0].translation.assistedCorrection.appliedAt = date },
      value => { value.translation.assistedCorrections = [] },
      value => { value.translation.assistedCorrections.push(structuredClone(receipt)) },
      value => { value.blocks[0].translation.extra = 'invented' },
      value => { value.translation.codexFallback.baseline.acceptedBlocks[0].translatedSha256 = sha256(value.blocks[0].zh) },
    ]) {
      const changed = structuredClone(completed); mutate(changed)
      // Keep the counterpart consistent so malformed fields exercise their
      // own validation, rather than failing only the ledger equality check.
      if (changed.translation.assistedCorrections.length === 1) {
        changed.translation.assistedCorrections[0] = structuredClone(changed.blocks[0].translation.assistedCorrection)
      }
      assert.throws(() => assertCodexFallbackReceipt(changed), /fallback receipt|Qwen fallback provenance/)
    }
  })
})

test('frozen fallback refuses edited accepted Qwen content, title, API history, manifest and invented Luna usage', async () => {
  await fixture(async ({ dataDir, filename, paper, save, draft }) => {
    const local = qwenCheckpoint(paper); await save(local)
    const manifest = createCodexTranslationManifest(local, { prompt, createdAt: fallbackAt, allowModelChange: true })
    const fallbackDraft = ids => ({ ...draft(ids), translatedAt: fallbackTranslatedAt })
    const first = await applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [fallbackDraft(['block-002:0', 'block-002:1'])], allowModelChange: true })
    for (const mutate of [
      value => { value.blocks[0].zh += '额外内容' },
      value => { value.blocks[0].translation.parameters.seed++ },
      value => { value.titleZh += '额外内容' },
      value => { value.translation.titleTranslation.model = 'gpt-6-luna' },
      value => { value.translation.usage.promptTokens++ },
      value => { value.translation.usageByModel['gpt-6-luna'] = { promptTokens: 0, completionTokens: 0 } },
      value => { value.translation.usageScope = 'all-models' },
      value => { value.translation.modelHistory[0].parameters.seed++ },
      value => { value.translation.modelHistory.at(-1).usage = { promptTokens: 0, completionTokens: 0 } },
      value => { value.translation.requestBudget = local.translation.requestBudget },
      value => { value.translation.manifestSha256 = 'f'.repeat(64) },
    ]) {
      const changed = structuredClone(first); mutate(changed); await save(changed)
      const before = await readFile(filename, 'utf8')
      assert.throws(() => assertCodexFallbackReceipt(changed), /fallback receipt|Qwen fallback provenance/)
      await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [fallbackDraft(['block-003:0'])] }), /fallback receipt|Qwen fallback provenance/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
    await save(first)
    await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [fallbackDraft(['__title:0'])] }), /replace an accepted/)
    await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [fallbackDraft(['block-001:0'])] }), /replace an accepted/)
    const changedManifest = structuredClone(manifest); changedManifest.prompt += ' changed'; changedManifest.promptSha256 = sha256(changedManifest.prompt)
    await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest: changedManifest, drafts: [fallbackDraft(['block-003:0'])] }), /manifest changed/)
  })
})

test('allowModelChange cannot excuse fabricated API fields on a native Luna continuation', async () => {
  await fixture(async ({ dataDir, paper, save, draft, apply, manifest }) => {
    const first = await apply([draft(['__title:0', 'block-001:0'])])
    for (const metadata of [{ usage: { promptTokens: 0, completionTokens: 0 } }, { modelHistory: [] }, { requestBudget: { maxTokens: 4096 } }]) {
      const changed = structuredClone(first); Object.assign(changed.translation, metadata); await save(changed)
      await assert.rejects(applyCodexTranslations({ dataDir, id: paper.id, manifest, drafts: [draft(['block-003:0'])], allowModelChange: true }), /invent or replace/)
    }
  })
})

test('initial API history starts before checkpoint creation while resumes and accepted outputs remain ordered', async () => {
  await fixture(async ({ dataDir, paper, save, draft }) => {
    const local = qwenCheckpoint(paper)
    // Actual Gemma 2 initialization records .476Z then createdAt .477Z.
    local.translation.createdAt = '2026-01-01T00:00:00.001Z'
    await save(local)
    const options = { prompt, createdAt: fallbackAt, allowModelChange: true }
    const manifest = createCodexTranslationManifest(local, options)
    assert.equal(manifest.modelChange.translation.modelHistory[0].startedAt, date)
    assert.equal(manifest.modelChange.translation.createdAt, local.translation.createdAt)
    const accepted = await applyCodexTranslations({ dataDir, id: paper.id, manifest,
      drafts: [{ ...draft(['block-003:0']), translatedAt: fallbackTranslatedAt }], allowModelChange: true })
    assert.deepEqual(accepted.translation.codexFallback.baseline.translation, local.translation)
    for (const mutate of [
      value => { value.translation.modelHistory[0].startedAt = '2026-01-01T00:00:00.002Z' },
      value => { value.translation.modelHistory[1].startedAt = date },
      value => { value.blocks[0].translation.translatedAt = date },
      value => { value.translation.updatedAt = '2025-12-31T23:59:59.999Z' },
      value => { value.translation.modelHistory[1].coverageAtStart.complete = 3 },
    ]) {
      const changed = structuredClone(local); mutate(changed)
      assert.throws(() => createCodexTranslationManifest(changed, options), /Qwen fallback provenance/)
    }
  })
})

test('native Luna continuation rejects fabricated block counters and changed source-paper hashes without writes', async () => {
  await fixture(async ({ filename, save, draft, apply }) => {
    const first = await apply([draft(['__title:0', 'block-001:0'])])
    for (const mutate of [
      value => { value.blocks[0].translation.usage = { promptTokens: 0, completionTokens: 0 } },
      value => { value.blocks[0].translation.usageByModel = { 'gpt-6-luna': { promptTokens: 0, completionTokens: 0 } } },
      value => { value.blocks[0].translation.sourcePaperSha256 = 'f'.repeat(64) },
      value => { value.blocks[0].translation.translatedSha256 = 'f'.repeat(64) },
    ]) {
      const changed = structuredClone(first); mutate(changed); await save(changed)
      const before = await readFile(filename, 'utf8')
      await assert.rejects(apply([draft(['block-003:0'])]), /provenance is stale/)
      assert.equal(await readFile(filename, 'utf8'), before)
    }
  })
})
