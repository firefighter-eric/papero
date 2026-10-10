import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { load } from 'cheerio'
import { applyCodexTranslations, createCodexTranslationManifest } from './apply-codex-translations.mjs'
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
