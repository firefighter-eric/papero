import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inspectPublicData, prepareData } from './prepare-data.mjs'
import { verifyReleaseData } from './verify-release-data.mjs'
import { catalogEntry, sanitizeHtml, sha256, translationUnits } from './paper-lib.mjs'
import { beginModelRun, recordModelUsage } from './translation-provenance.mjs'
import { createPublication } from './publication-html.mjs'

const model = 'qwen3.8-27b-splash', date = '2026-01-01T00:00:00.000Z', prompt = sha256('synthetic test prompt')
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 1000\n'
const secondModel = 'qwen3.6-35b-a3b', secondDate = '2026-02-01T00:00:00.000Z'

function sourceOnlyEntry(overrides = {}) {
  return { access: 'source-only', id: 'source-report', arxivId: '2601.00001v2', sourceKind: 'arxiv',
    title: 'Source Report', titleZh: null, authors: ['Source Author'], year: 2026, tags: ['Testing'],
    sourceUrl: 'https://arxiv.org/abs/2601.00001v2', sourceHtmlUrl: 'https://arxiv.org/html/2601.00001v2',
    dataPath: null, blockCount: 0, sectionCount: 0, translationStatus: 'pending', abstract: '', abstractZh: '', ...overrides }
}

const sourceArticle = () => sourceOnlyEntry({ id: 'source-article', arxivId: null, sourceKind: 'official-article',
  title: 'Official Article', sourceUrl: 'https://qwen.ai/blog?id=qwen3.5', sourceHtmlUrl: 'https://qwen.ai/blog?id=qwen3.5' })

async function addSources(dataDir, entries) {
  const filename = path.join(dataDir, 'catalog.json')
  const catalog = JSON.parse(await readFile(filename, 'utf8'))
  catalog.papers = [...catalog.papers.filter(entry => entry.access !== 'source-only'), ...entries]
  await writeFile(filename, JSON.stringify(catalog))
}

function mixedModelFixture(paper) {
  const old = structuredClone(paper.translation)
  const parameters = { ...old.parameters, temperature: 0.2 }
  const modelIdentity = { apiModelId: secondModel, format: 'mlx', quantization: '4bit', verifiedAt: secondDate }
  const en = sanitizeHtml('<p id="new-narrative">The model uses 4 layers.</p>')
  paper.blocks[0].translation = { ...paper.blocks[0].translation, parameters: structuredClone(old.parameters), modelIdentity: structuredClone(old.modelIdentity) }
  paper.blocks.push({ id: 'block-004', sourceId: 'new-narrative', sectionId: 'intro', kind: 'paragraph', en,
    zh: sanitizeHtml('<p id="new-narrative">模型使用 4 层。</p>'),
    translation: { status: 'machine', model: secondModel, modelIdentity: structuredClone(modelIdentity), parameters: structuredClone(parameters), sourceSha256: sha256(en),
      promptSha256: prompt, translatedAt: '2026-02-01T00:01:00.000Z' } })
  const history = (model, identity, settings, startedAt, reason, complete, extra = {}) => ({
    model, modelIdentity: structuredClone(identity), provider: old.provider, parameters: structuredClone(settings), promptSha256: prompt,
    startedAt, reason, coverageAtStart: { complete, total: 4 }, ...extra,
  })
  paper.translation = { ...old, model: secondModel, modelIdentity, parameters,
    coverage: { complete: 4, total: 4 }, updatedAt: '2026-02-01T00:02:00.000Z', completedAt: '2026-02-01T00:02:00.000Z',
    modelsUsed: [model, secondModel], modelIdentities: { [model]: structuredClone(old.modelIdentity), [secondModel]: structuredClone(modelIdentity) },
    modelHistory: [history(model, old.modelIdentity, old.parameters, date, 'legacy-provenance', 0),
      history(secondModel, modelIdentity, parameters, secondDate, 'explicit-model-change', 3, { previousModel: model })],
    usageByModel: { [model]: { promptTokens: 10, completionTokens: 20 }, [secondModel]: { promptTokens: 5, completionTokens: 10, observedReasoningTokens: 0, reasoningUsageResponses: 1 } },
    usage: { promptTokens: 15, completionTokens: 30, observedReasoningTokens: 0, reasoningUsageResponses: 1 },
  }
  paper.statistics.blockCount = 4
}

function assistedCorrectionFixture(paper) {
  mixedModelFixture(paper)
  const block = paper.blocks[3]
  const instructionsSha256 = sha256('Synthetic draft guidance: preserve the exact count of 4 layers.')
  block.translation.reviewCorrection = { method: 'scoped-review-instructions', instructionsSha256 }
  const receipt = { id: 'synthetic-draft-reference', blockId: block.id, sourceId: block.sourceId,
    method: 'model-retranslation-with-draft-reference', assistingModel: 'gpt-6-luna', assistingProvider: 'Codex subagent', primaryModel: secondModel,
    sourceSha256: paper.source.sha256, sourceBlockSha256: sha256(block.en), draftSha256: sha256('Synthetic source-only draft.'), instructionsSha256,
    appliedAt: '2026-02-01T00:01:30.000Z' }
  paper.translation.assistedCorrections = [structuredClone(receipt)]
  block.translation.assistedCorrection = structuredClone(receipt)
  return { block, receipt: paper.translation.assistedCorrections[0] }
}

function fragmentCorrectionReceipt(paper, block, unitIds = [0]) {
  return { id: `fragment-correction-${block.id}`, blockId: block.id, sourceId: block.sourceId,
    method: 'codex-subagent-fragment-correction', assistingModel: 'gpt-6-luna', assistingProvider: 'Codex subagent', primaryModel: block.translation.model,
    sourceSha256: paper.source.sha256, sourceBlockSha256: sha256(block.en), draftSha256: sha256('Actual synthetic correction draft.'),
    previousChineseSha256: sha256('Previous synthetic Chinese body.'), correctedChineseSha256: sha256(block.zh), unitIds,
    appliedAt: '2026-02-01T00:01:30.000Z' }
}

function fragmentCorrectionFixture(paper) {
  mixedModelFixture(paper)
  const block = paper.blocks[3]
  const unchanged = '<math><mi>N</mi><mo>=</mo><mn>4</mn></math> <code>const count = 4;</code>'
  block.en = sanitizeHtml(`<p id="new-narrative">The model uses 4 layers. <span>The input remains exact.</span> A separate unit names the architecture. <strong>Training uses 8 batches.</strong> Evaluation keeps the same settings. <a href="#narrative">See the original section.</a> ${unchanged}</p>`)
  block.zh = sanitizeHtml(`<p id="new-narrative">模型使用 4 层。 <span>输入保持准确。</span> 一个独立片段说明架构。 <strong>训练使用 8 个批次。</strong> 评估保持相同设置。 <a href="#narrative">参见原始章节。</a> ${unchanged}</p>`)
  block.translation.sourceSha256 = sha256(block.en)
  const receipt = fragmentCorrectionReceipt(paper, block, [3, 4])
  receipt.previousChineseSha256 = sha256(block.zh.replace('训练使用', '训练不使用'))
  paper.translation.assistedCorrections = [receipt]
  block.translation.assistedCorrection = structuredClone(receipt)
  return { block, receipt }
}

async function fixture(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-public-data-'))
  const dataDir = path.join(directory, 'paper-data'), paperDir = path.join(dataDir, 'papers', 'synthetic-report')
  const en = sanitizeHtml('<p id="narrative">The model uses 2 layers. <img src="assets/figure.png" alt="Architecture"></p>')
  const equation = sanitizeHtml('<math display="block"><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow></math>')
  const code = sanitizeHtml('<pre><code>const count = 2;</code></pre>')
  const paper = { schemaVersion: 1, id: 'synthetic-report', arxivId: '2401.00001v1', title: 'Synthetic Report', titleZh: '合成测试报告',
    authors: ['Test Author'], year: 2024, tags: ['Testing'], abstract: 'Synthetic fixture.', abstractZh: '合成夹具。',
    source: { kind: 'arxiv', url: 'https://arxiv.org/abs/2401.00001v1', htmlUrl: 'https://arxiv.org/html/2401.00001v1', sha256: sha256('excluded synthetic raw source'), fetchedAt: date },
    translation: { status: 'machine', model, provider: 'LM Studio local API', method: 'DOM text node translation', humanReviewed: false,
      coverage: { complete: 3, total: 3 }, createdAt: date, updatedAt: date, completedAt: date, promptSha256: prompt,
      modelIdentity: { apiModelId: model }, parameters: { temperature: 0.1, top_p: 0.9, max_tokens: 7000, seed: 42, reasoning_effort: 'none', stream: false } },
    sections: [{ id: 'intro', title: 'Introduction', titleZh: '引言', level: 2 }],
    blocks: [
      { id: 'block-001', sourceId: 'narrative', sectionId: 'intro', kind: 'paragraph', en,
        zh: sanitizeHtml('<p id="narrative">模型使用 2 层。 <img src="assets/figure.png" alt="Architecture"></p>'),
        translation: { status: 'machine', model, sourceSha256: sha256(en), promptSha256: prompt, translatedAt: date } },
      { id: 'block-002', sourceId: 'equation', sectionId: 'intro', kind: 'equation', en: equation, zh: equation, translation: { status: 'preserved', model: null } },
      { id: 'block-003', sourceId: 'code', sectionId: 'intro', kind: 'code', en: code, zh: code, translation: { status: 'preserved', model: null } },
    ], statistics: { blockCount: 3, sectionCount: 1 },
    assets: [{ filename: 'figure.png', sourceUrl: 'https://example.com/figure.png', sha256: sha256(image), sourceSha256: sha256(image), bytes: image.length }],
  }
  async function save(entryOverrides = {}, { raw = false } = {}) {
    const publication = raw ? null : createPublication(paper)
    await writeFile(path.join(paperDir, 'paper.json'), JSON.stringify(publication?.metadata || paper))
    if (publication) for (const language of ['en', 'zh']) await writeFile(path.join(paperDir, `${language}.html`), publication.html[language])
    else for (const language of ['en', 'zh']) await rm(path.join(paperDir, `${language}.html`), { force: true })
    await writeFile(path.join(dataDir, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: [{ ...catalogEntry(paper), ...entryOverrides }] }))
  }
  try {
    await mkdir(path.join(paperDir, 'assets'), { recursive: true })
    await writeFile(path.join(paperDir, 'assets', 'figure.png'), image)
    await save()
    await action({ directory, dataDir, paperDir, paper, save })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('default build excludes data without reading it; explicit export retains partial development data but excludes raw/private files', async () => {
  await fixture(async ({ directory, dataDir, paperDir, paper, save }) => {
    paper.blocks[0].zh = null
    paper.translation.status = 'pending'; paper.translation.coverage.complete = 2
    await save({}, { raw: true })
    await writeFile(path.join(paperDir, 'source.html'), '<p>Excluded raw source</p>')
    await writeFile(path.join(paperDir, 'translation-response.json'), '{"private":"debug"}')
    await writeFile(path.join(paperDir, 'assets', 'private.txt'), 'not a public asset')
    const outDir = path.join(directory, 'dist')
    const excluded = await prepareData({ dataDir: path.join(directory, 'absent'), outDir, include: false })
    assert.equal(excluded.included, false)
    const exported = await prepareData({ dataDir, outDir, include: true })
    assert.equal(exported.fileCount, 5)
    assert.deepEqual(await readdir(path.join(exported.output, 'papers', paper.id)), ['assets', 'en.html', 'paper.json', 'zh.html'])
    assert.deepEqual(await readdir(path.join(exported.output, 'papers', paper.id, 'assets')), ['figure.png'])
    await assert.rejects(verifyReleaseData({ dataDir: exported.output, report: () => {} }), /translation incomplete/)
    await prepareData({ dataDir, outDir, include: false })
    assert.deepEqual(await readdir(outDir), [])
  })
})

test('a complete processed snapshot verifies without raw HTML and preserves all exported fingerprints', async () => {
  await fixture(async ({ directory, dataDir }) => {
    const logs = []
    const result = await verifyReleaseData({ dataDir, report: value => logs.push(value) })
    assert.deepEqual(result, { papers: 1, blocks: 3, assets: 1, files: 5, rawSourceVerified: false })
    assert.equal(logs[0].rawSourceVerified, false)
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    const before = await inspectPublicData({ dataDir }), after = await inspectPublicData({ dataDir: exported.output })
    assert.deepEqual([...after.files], [...before.files])
    await verifyReleaseData({ dataDir: exported.output, report: () => {} })
  })
})

test('a mixed catalog exports and verifies source-only metadata without requiring any document or asset files', async () => {
  await fixture(async ({ directory, dataDir, paper }) => {
    await addSources(dataDir, [sourceOnlyEntry(), sourceArticle()])
    const inspected = await inspectPublicData({ dataDir })
    assert.equal(inspected.papers.length, 3)
    assert.equal(inspected.files.size, 5)
    assert.deepEqual(inspected.papers.slice(1), [sourceOnlyEntry(), sourceArticle()].map(entry => ({ entry, paper: null, metadata: null, dataPath: null })))
    const expected = { papers: 3, blocks: 3, assets: 1, files: 5, rawSourceVerified: false, sourceOnlyPapers: 2, completePapers: 1 }
    const reports = []
    assert.deepEqual(await verifyReleaseData({ dataDir, report: value => reports.push(value) }), expected)
    assert.deepEqual(reports, [{ type: 'public-release-verified', ...expected }])
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    assert.equal(exported.paperCount, 3)
    assert.equal(exported.fileCount, 5)
    assert.deepEqual(await readdir(path.join(exported.output, 'papers')), [paper.id])
    assert.deepEqual(await readFile(path.join(exported.output, 'catalog.json')), await readFile(path.join(dataDir, 'catalog.json')))
    assert.deepEqual(await verifyReleaseData({ dataDir: exported.output, report: () => {} }), expected)
  })
})

test('source-only export copies catalog metadata while release still requires at least one complete document', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-sources-only-'))
  try {
    const dataDir = path.join(directory, 'input')
    await mkdir(dataDir)
    await writeFile(path.join(dataDir, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: [sourceOnlyEntry(), sourceArticle()] }))
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    assert.equal(exported.paperCount, 2)
    assert.equal(exported.fileCount, 1)
    assert.deepEqual(await readdir(exported.output), ['catalog.json'])
    await assert.rejects(verifyReleaseData({ dataDir: exported.output, report: () => {} }), /at least one complete document/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('source-only catalog entries reject body paths, translation data, invalid metadata, missing fields and unknown content fields', async () => {
  const mutations = [
    entry => { entry.dataPath = 'papers/synthetic-report/paper.json' },
    entry => { entry.dataPath = 'papers/source-report/paper.json' },
    entry => { entry.dataPath = '../private.json' },
    entry => { entry.blockCount = 1 },
    entry => { entry.sectionCount = 1 },
    entry => { entry.translationStatus = 'machine' },
    entry => { entry.titleZh = '来源报告' },
    entry => { entry.abstract = 'Full abstract' },
    entry => { entry.abstractZh = '译文摘要' },
    entry => { entry.abstractZh = null },
    entry => { entry.blocks = [{ en: '<p>Private body</p>', zh: '私有译文' }] },
    entry => { entry.content = { format: 'html' } },
    entry => { entry.assets = [] },
    entry => { entry.translation = { status: 'pending' } },
    entry => { entry.title = '' },
    entry => { entry.title = 'x'.repeat(2_001) },
    entry => { entry.id = 'x'.repeat(161) },
    entry => { entry.authors = [] },
    entry => { entry.authors = [''] },
    entry => { entry.year = 2026.5 },
    entry => { entry.tags = [''] },
    entry => { entry.sourceKind = 'other' },
    entry => { delete entry.sourceKind },
    entry => { delete entry.abstract },
    entry => { delete entry.abstractZh },
  ]
  await fixture(async ({ directory, dataDir }) => {
    for (const mutate of mutations) {
      const entry = sourceOnlyEntry()
      mutate(entry)
      await addSources(dataDir, [entry])
      await assert.rejects(inspectPublicData({ dataDir }), /source-only|Source-only/)
      await assert.rejects(prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true }), /source-only|Source-only/)
      await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /source-only|Source-only/)
    }
  })
})

test('source-only identities require exact pinned arXiv links and safe official article HTTPS links', async () => {
  const entries = [
    sourceOnlyEntry({ arxivId: '2601.00001' }),
    sourceOnlyEntry({ arxivId: '2601.00001v0' }),
    sourceOnlyEntry({ arxivId: `2601.00001v${'1'.repeat(160)}`,
      sourceUrl: `https://arxiv.org/abs/2601.00001v${'1'.repeat(160)}`, sourceHtmlUrl: `https://arxiv.org/html/2601.00001v${'1'.repeat(160)}` }),
    sourceOnlyEntry({ sourceUrl: 'https://arxiv.org/abs/2601.00001v1' }),
    sourceOnlyEntry({ sourceHtmlUrl: 'https://arxiv.org/html/2601.00001' }),
    sourceOnlyEntry({ sourceUrl: 'https://arxiv.org/abs/2601.00001v2#body' }),
    sourceOnlyEntry({ sourceUrl: 'https://arxiv.org.evil.example/abs/2601.00001v2' }),
    sourceOnlyEntry({ sourceHtmlUrl: 'https://evil.example/html/2601.00001v2' }),
    sourceOnlyEntry({ sourceUrl: 'javascript:alert(1)' }),
    { ...sourceArticle(), arxivId: '2601.00001v2' },
  ]
  for (const url of ['http://qwen.ai/blog', 'javascript:alert(1)', '//qwen.ai/blog', 'https://user:password@qwen.ai/blog',
    'https://qwen.ai/blog\n', 'https://qwen.ai\\@evil.example/blog', 'https://']) {
    entries.push({ ...sourceArticle(), sourceUrl: url }, { ...sourceArticle(), sourceHtmlUrl: url })
  }
  await fixture(async ({ dataDir }) => {
    for (const entry of entries) {
      await addSources(dataDir, [entry])
      await assert.rejects(inspectPublicData({ dataDir }), /source-only.*identity/)
    }
    await addSources(dataDir, [sourceOnlyEntry({ id: 'synthetic-report' })])
    await assert.rejects(inspectPublicData({ dataDir }), /duplicate paper ID/)
  })
})

test('source-only local document and source files are never read or exported and any source-only public directory is rejected', async () => {
  await fixture(async ({ directory, dataDir, paper }) => {
    const entry = sourceOnlyEntry(), sourceDir = path.join(dataDir, 'papers', entry.id)
    await addSources(dataDir, [entry])
    await mkdir(path.join(sourceDir, 'assets'), { recursive: true })
    for (const relative of ['paper.json', 'en.html', 'zh.html', 'source.html', 'assets/private.png']) {
      await writeFile(path.join(sourceDir, relative), pointer)
    }
    const inspected = await inspectPublicData({ dataDir })
    assert.equal(inspected.files.size, 5)
    assert.ok([...inspected.files.keys()].every(relative => !relative.includes(entry.id)))
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    assert.deepEqual(await readdir(path.join(exported.output, 'papers')), [paper.id])
    await verifyReleaseData({ dataDir: exported.output, report: () => {} })
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Unexpected public release file or directory: papers\/source-report/)
    await rm(sourceDir, { recursive: true })
    const exportedSourceDir = path.join(exported.output, 'papers', entry.id)
    for (const relative of [null, 'paper.json', 'en.html', 'source.html', 'assets/private.png']) {
      await mkdir(relative ? path.dirname(path.join(exportedSourceDir, relative)) : exportedSourceDir, { recursive: true })
      if (relative) await writeFile(path.join(exportedSourceDir, relative), pointer)
      await assert.rejects(verifyReleaseData({ dataDir: exported.output, report: () => {} }), /Unexpected public release file or directory: papers\/source-report/)
      await rm(exportedSourceDir, { recursive: true })
    }
    await writeFile(path.join(exported.output, 'source.html'), 'private source')
    await assert.rejects(verifyReleaseData({ dataDir: exported.output, report: () => {} }), /Unexpected public release file or directory: source.html/)
  })
})

test('source-only entries do not weaken complete-document fingerprints, translation completeness or catalog matching', async () => {
  for (const [mutate, override, expected] of [
    [paper => { paper.blocks[0].zh = null; paper.translation.status = 'pending'; paper.translation.coverage.complete = 2 }, {}, /translation incomplete/],
    [paper => { paper.blocks[0].translation.sourceSha256 = 'a'.repeat(64) }, {}, /stale block translation/],
    [() => {}, { blockCount: 99 }, /Catalog\/document mismatch/],
    [() => {}, { access: 'full-text' }, /Unsupported catalog access mode/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    mutate(paper)
    await save(override)
    await addSources(dataDir, [sourceOnlyEntry()])
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
  await fixture(async ({ dataDir, paperDir }) => {
    await addSources(dataDir, [sourceOnlyEntry()])
    await writeFile(path.join(paperDir, 'en.html'), '<p>Changed body</p>')
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /document fingerprint or byte-count mismatch/)
  })
})

test('internal checkpoint JSON exports exact standalone bilingual HTML and never re-encodes a published snapshot', async () => {
  await fixture(async ({ directory, dataDir, paper, save }) => {
    const en = sanitizeHtml('<table id="results"><tbody><tr><th>Layers</th><td>2</td></tr></tbody></table>')
    paper.blocks.push({ id: 'block-004', sourceId: 'results', sectionId: 'intro', kind: 'table', en,
      zh: sanitizeHtml('<table id="results"><tbody><tr><th>层数</th><td>2</td></tr></tbody></table>'),
      translation: { status: 'machine', model, sourceSha256: sha256(en), promptSha256: prompt, translatedAt: date } })
    paper.translation.coverage = { complete: 4, total: 4 }; paper.statistics.blockCount = 4
    await save({}, { raw: true })
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /requires standalone/)
    const first = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    const inspected = await inspectPublicData({ dataDir: first.output })
    const metadata = inspected.papers[0].metadata
    assert.equal(metadata.content.format, 'html')
    for (const block of metadata.blocks) { assert.equal('en' in block, false); assert.equal('zh' in block, false) }
    for (const language of ['en', 'zh']) {
      assert.deepEqual(inspected.papers[0].paper.blocks.map(block => block[language]), paper.blocks.map(block => block[language]))
      const html = await readFile(path.join(first.output, 'papers', paper.id, `${language}.html`), 'utf8')
      assert.match(html, /^<!doctype html>/)
      assert.ok(html.includes(paper.blocks[1][language]))
      assert.ok(html.includes(paper.blocks[2][language]))
      assert.ok(html.includes(paper.blocks[3][language]))
    }
    await verifyReleaseData({ dataDir: first.output, report: () => {} })
    const second = await prepareData({ dataDir: first.output, outDir: path.join(directory, 'again'), include: true })
    const copied = await inspectPublicData({ dataDir: second.output })
    assert.deepEqual([...copied.files], [...inspected.files])
    for (const relative of inspected.files.keys()) assert.deepEqual(await readFile(path.join(second.output, relative)), await readFile(path.join(first.output, relative)))
  })
})

test('raw export includes only referenced assets while validating and preserving the complete input snapshot', async () => {
  await fixture(async ({ directory, dataDir, paperDir, paper, save }) => {
    const unused = { ...paper.assets[0], filename: 'unused-preview.png', sourceUrl: 'https://example.com/unused-preview.png' }
    paper.assets.push(unused)
    const unusedPath = path.join(paperDir, 'assets', unused.filename)
    await writeFile(unusedPath, image)
    await save({}, { raw: true })
    const before = await inspectPublicData({ dataDir })
    assert.equal(before.files.size, 4)
    const inputBytes = new Map(await Promise.all([...before.files.keys()].map(async relative => [relative, await readFile(path.join(dataDir, relative))])))
    const outDir = path.join(directory, 'dist')
    const exported = await prepareData({ dataDir, outDir, include: true })
    assert.equal(exported.fileCount, 5)
    assert.deepEqual(await readdir(path.join(exported.output, 'papers', paper.id, 'assets')), ['figure.png'])
    const output = await inspectPublicData({ dataDir: exported.output })
    assert.equal(output.files.size, exported.fileCount)
    assert.deepEqual(output.papers[0].metadata.assets, [paper.assets[0]])
    for (const language of ['en', 'zh']) assert.deepEqual(output.papers[0].paper.blocks.map(block => block[language]), paper.blocks.map(block => block[language]))
    assert.deepEqual(await verifyReleaseData({ dataDir: exported.output, report: () => {} }),
      { papers: 1, blocks: 3, assets: 1, files: 5, rawSourceVerified: false })
    assert.deepEqual([...((await inspectPublicData({ dataDir })).files)], [...before.files])
    for (const [relative, bytes] of inputBytes) assert.deepEqual(await readFile(path.join(dataDir, relative)), bytes)

    // An omitted asset is still inspected rather than silently ignored when corrupt or missing.
    await writeFile(unusedPath, 'corrupt unused asset')
    await assert.rejects(prepareData({ dataDir, outDir, include: true }), /fingerprint or byte-count mismatch/)
    await rm(unusedPath)
    await assert.rejects(prepareData({ dataDir, outDir, include: true }), /ENOENT/)
    await writeFile(unusedPath, image)

    // An existing HTML publication is copied exactly, leaving closure validation to the release verifier.
    await save()
    const published = await inspectPublicData({ dataDir })
    const copied = await prepareData({ dataDir, outDir: path.join(directory, 'published-copy'), include: true })
    assert.equal(copied.fileCount, published.files.size)
    for (const relative of published.files.keys()) assert.deepEqual(await readFile(path.join(copied.output, relative)), await readFile(path.join(dataDir, relative)))
    await assert.rejects(verifyReleaseData({ dataDir: copied.output, report: () => {} }), /metadata\/reference count mismatch/)

    for (const language of ['en', 'zh']) paper.blocks[0][language] = paper.blocks[0][language].replace('assets/figure.png', 'assets/missing.png')
    paper.blocks[0].translation.sourceSha256 = sha256(paper.blocks[0].en)
    await save({}, { raw: true })
    await assert.rejects(prepareData({ dataDir, outDir, include: true }), /Referenced asset has no metadata/)
    assert.deepEqual([...((await inspectPublicData({ dataDir: exported.output })).files)], [...output.files])
  })
})

test('published documents reject tampered hashes, body metadata, changed markers and active document structure', async () => {
  for (const [change, expected] of [
    [html => html + 'modified', /document fingerprint or byte-count/],
    [html => html.replace('data-block-id="block-001"', 'data-block-id="different"'), /block marker or order/],
    [html => html.replace('</head>', '<script>alert(1)</script></head>'), /Unexpected publication document structure/],
    [html => html.replace('The model uses 2', 'The model uses 3'), /block fingerprint mismatch/],
  ]) await fixture(async ({ dataDir, paperDir, paper }) => {
    const filename = path.join(paperDir, 'en.html')
    const html = change(await readFile(filename, 'utf8'))
    await writeFile(filename, html)
    if (!/document fingerprint/.test(expected.source)) {
      const metadata = JSON.parse(await readFile(path.join(paperDir, 'paper.json'), 'utf8'))
      metadata.content.en.sha256 = sha256(html); metadata.content.en.bytes = Buffer.byteLength(html)
      if (html.includes('<script>alert(1)</script>')) for (const block of metadata.blocks) {
        block.contentOffsets.en.start += Buffer.byteLength('<script>alert(1)</script>')
        block.contentOffsets.en.end += Buffer.byteLength('<script>alert(1)</script>')
      }
      await writeFile(path.join(paperDir, 'paper.json'), JSON.stringify(metadata))
    }
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
  await fixture(async ({ dataDir, paperDir, paper }) => {
    const metadata = JSON.parse(await readFile(path.join(paperDir, 'paper.json'), 'utf8'))
    metadata.blocks[0].en = paper.blocks[0].en
    await writeFile(path.join(paperDir, 'paper.json'), JSON.stringify(metadata))
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /metadata contains body HTML/)
  })
})

test('raw UTF-8 offsets bind repeated body text to its own wrapper and reject broken character boundaries', async () => {
  await fixture(async ({ dataDir, paperDir, paper, save }) => {
    paper.blocks.push({ ...structuredClone(paper.blocks[0]), id: 'block-004', sourceId: 'repeated-narrative' })
    paper.translation.coverage = { complete: 4, total: 4 }; paper.statistics.blockCount = 4
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    const metadata = JSON.parse(await readFile(path.join(paperDir, 'paper.json'), 'utf8'))
    metadata.blocks[3].contentOffsets.en = metadata.blocks[0].contentOffsets.en
    await writeFile(path.join(paperDir, 'paper.json'), JSON.stringify(metadata))
    await assert.rejects(inspectPublicData({ dataDir }), /byte offsets disagree with wrapper boundaries/)
  })
  await fixture(async ({ dataDir, paperDir }) => {
    const metadata = JSON.parse(await readFile(path.join(paperDir, 'paper.json'), 'utf8'))
    const bytes = await readFile(path.join(paperDir, 'zh.html'))
    metadata.blocks[0].contentOffsets.zh.start = bytes.indexOf(Buffer.from('模型使用')) + 1
    await writeFile(path.join(paperDir, 'paper.json'), JSON.stringify(metadata))
    await assert.rejects(inspectPublicData({ dataDir }), /Invalid UTF-8 publication block boundary/)
  })
})

test('unhydrated LFS pointers in catalog, paper JSON or an image fail with a specific hydration error', async () => {
  for (const relative of ['catalog.json', 'papers/synthetic-report/paper.json', 'papers/synthetic-report/en.html', 'papers/synthetic-report/zh.html', 'papers/synthetic-report/assets/figure.png']) {
    await fixture(async ({ dataDir, directory }) => {
      await writeFile(path.join(dataDir, relative), pointer)
      await assert.rejects(prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true }), /Unhydrated Git LFS pointer:.*git lfs pull/)
    })
  }
})

test('missing, corrupt or undeclared assets fail before replacing a previously valid export', async () => {
  await fixture(async ({ directory, dataDir, paperDir, paper, save }) => {
    const outDir = path.join(directory, 'dist')
    const original = await prepareData({ dataDir, outDir, include: true })
    const oldCatalog = await readFile(path.join(original.output, 'catalog.json'))
    await writeFile(path.join(paperDir, 'assets', 'figure.png'), 'corrupt bytes')
    await assert.rejects(prepareData({ dataDir, outDir, include: true }), /fingerprint or byte-count mismatch/)
    assert.deepEqual(await readFile(path.join(original.output, 'catalog.json')), oldCatalog)
    assert.deepEqual(await readFile(path.join(original.output, 'papers', paper.id, 'assets', 'figure.png')), image)
    await rm(path.join(paperDir, 'assets', 'figure.png'))
    await assert.rejects(inspectPublicData({ dataDir }), /ENOENT/)
    await writeFile(path.join(paperDir, 'assets', 'figure.png'), image)
    await writeFile(path.join(paperDir, 'assets', 'undeclared.png'), image)
    await assert.rejects(inspectPublicData({ dataDir }), /no metadata/)
    await rm(path.join(paperDir, 'assets', 'undeclared.png'))
    paper.assets.push({ ...paper.assets[0] }); await save()
    await assert.rejects(inspectPublicData({ dataDir }), /duplicate asset metadata/)
  })
})

test('release rejects raw/debug files and symlink escapes instead of silently publishing them', async () => {
  await fixture(async ({ directory, dataDir, paperDir }) => {
    await writeFile(path.join(paperDir, 'source.html'), 'must not be public')
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Unexpected public release file/)
    await rm(path.join(paperDir, 'source.html'))
    await mkdir(path.join(paperDir, 'source-assets'))
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Unexpected public release file or directory/)
    await rm(path.join(paperDir, 'source-assets'), { recursive: true })
    const outside = path.join(directory, 'outside.png')
    await writeFile(outside, image)
    await rm(path.join(paperDir, 'assets', 'figure.png'))
    await symlink(outside, path.join(paperDir, 'assets', 'figure.png'))
    await assert.rejects(inspectPublicData({ dataDir }), /escapes DATA_DIR/)
  })
})

test('release rejects stale block/source metadata, incomplete title and a false human-reviewed claim', async () => {
  for (const [change, expected] of [
    [p => { p.blocks[0].translation.sourceSha256 = 'a'.repeat(64) }, /stale block translation/],
    [p => { p.source.sha256 = 'missing' }, /source provenance/],
    [p => { p.titleZh = null }, /translation incomplete/],
    [p => { p.translation.humanReviewed = true }, /humanReviewed=false/],
    [p => { p.translation.modelIdentity.apiModelId = 'different-model' }, /translation provenance/],
    [p => { p.translation.coverage.complete = 2 }, /translation incomplete/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    change(paper); await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
})

test('release enforces catalog counts, document identity, section references and the image metadata closure', async () => {
  for (const [change, override, expected] of [
    [() => {}, { blockCount: 99 }, /Catalog\/document mismatch/],
    [() => {}, { dataPath: 'papers/another-paper/paper.json' }, /disagrees with paper ID/],
    [p => { p.blocks[0].sectionId = 'missing' }, {}, /Invalid release block/],
    [p => { p.assets = [] }, {}, /no metadata/],
    [p => { p.blocks[0].en = p.blocks[0].en.replace('<img src="assets/figure.png" alt="Architecture">', ''); p.blocks[0].zh = p.blocks[0].zh.replace('<img src="assets/figure.png" alt="Architecture">', ''); p.blocks[0].translation.sourceSha256 = sha256(p.blocks[0].en) }, {}, /metadata\/reference count mismatch/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    change(paper); await save(override)
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
})

test('release retains exact equations, code and citations and rejects unsafe HTML even with plausible metadata', async () => {
  for (const [change, expected] of [
    [p => { p.blocks[1].zh = p.blocks[1].zh.replace('<mn>2</mn>', '<mn>3</mn>') }, /Preserved block changed/],
    [p => { p.blocks[2].zh = p.blocks[2].zh.replace('count = 2', 'count = 3') }, /Preserved block changed/],
    [p => { p.blocks[0].zh = p.blocks[0].zh.replace('</p>', '<script>alert(1)</script></p>') }, /Unsafe or noncanonical/],
    [p => { p.blocks[0].zh = p.blocks[0].zh.replace(' 2 ', ' 3 ') }, /translation fidelity/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    change(paper)
    await assert.rejects(async () => { await save(); await verifyReleaseData({ dataDir, report: () => {} }) }, expected)
  })
})

test('release preserves source anchors and verifies fragment targets independently for each language', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    const block = paper.blocks[0]
    block.en = block.en.replace('</p>', '<a href="#narrative">Section</a></p>')
    block.zh = block.zh.replace('</p>', '<a href="#narrative">章节</a></p>')
    block.translation.sourceSha256 = sha256(block.en)
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    block.zh = block.zh.replace('id="narrative"', 'id="changed-target"')
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Source HTML anchor changed/)
    block.zh = block.zh.replace('id="changed-target"', 'id="narrative"')
    block.en = block.en.replace('href="#narrative"', 'href="#missing-target"')
    block.zh = block.zh.replace('href="#narrative"', 'href="#missing-target"')
    block.translation.sourceSha256 = sha256(block.en)
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Broken internal reference: synthetic-report\/en\/#missing-target/)
  })
})

test('mixed-model release preserves actual historical models, settings and identities while retaining legacy compatibility', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    await verifyReleaseData({ dataDir, report: () => {} })
    mixedModelFixture(paper)
    // Identity verification time can differ across inventories; immutable model facts stay exact.
    paper.blocks[3].translation.modelIdentity = { ...paper.blocks[3].translation.modelIdentity, verifiedAt: '2026-02-01T00:00:30.000Z' }
    // Earlier prompt versions and isolated corrections keep their own actual prompt fingerprint.
    paper.blocks[0].translation.promptSha256 = sha256('earlier synthetic prompt')
    await save()
    const result = await verifyReleaseData({ dataDir, report: () => {} })
    assert.equal(result.blocks, 4)
    assert.equal(paper.blocks[0].translation.model, model)
    assert.equal(paper.blocks[3].translation.model, secondModel)
  })
})

test('mixed-model history retains settings from multiple runs of the same model', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    const t = paper.translation
    const current = { ...t.modelHistory.at(-1), parameters: { ...t.parameters, temperature: 0.3 },
      startedAt: '2026-02-01T00:01:30.000Z', reason: 'resume-model', coverageAtStart: { complete: 4, total: 4 } }
    delete current.previousModel
    t.modelHistory.push(current)
    t.parameters = current.parameters
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    // An earlier output retains its original settings rather than adopting the last run's settings.
    assert.equal(paper.blocks[3].translation.parameters.temperature, 0.2)
    assert.equal(t.parameters.temperature, 0.3)
  })
})

test('same-model resumes retain historical context lengths while the identity map describes the latest context', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    const t = paper.translation
    t.modelHistory[1].modelIdentity.contextLength = 16384
    paper.blocks[3].translation.modelIdentity.contextLength = 16384
    const currentIdentity = { ...t.modelIdentity, contextLength: 32768 }
    t.modelHistory.push({ ...t.modelHistory[1], modelIdentity: currentIdentity,
      startedAt: '2026-02-01T00:01:30.000Z', reason: 'resume-model', coverageAtStart: { complete: 4, total: 4 } })
    delete t.modelHistory[2].previousModel
    t.modelIdentity = currentIdentity
    t.modelIdentities[secondModel] = currentIdentity
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    t.modelIdentities[secondModel] = { ...currentIdentity, contextLength: 65536 }
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Latest model identity disagrees/)
  })
})

test('the translator provenance producer creates mixed metadata accepted by processed release validation', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    const old = structuredClone(paper.translation)
    const identity = { apiModelId: secondModel, format: 'mlx', quantization: '4bit' }
    const en = sanitizeHtml('<p id="next-narrative">The model uses 4 layers.</p>')
    const next = { id: 'block-004', sourceId: 'next-narrative', sectionId: 'intro', kind: 'paragraph', en, zh: null }
    paper.blocks.push(next)
    paper.translation.usage = { promptTokens: 10, completionTokens: 20 }
    beginModelRun(paper, { model: secondModel, modelIdentity: identity, provider: old.provider, parameters: old.parameters,
      promptSha256: prompt, startedAt: secondDate })
    recordModelUsage(paper.translation, secondModel, { prompt_tokens: 5, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 0 } })
    next.zh = sanitizeHtml('<p id="next-narrative">模型使用 4 层。</p>')
    next.translation = { status: 'machine', model: secondModel, modelIdentity: identity, parameters: old.parameters,
      provider: old.provider, sourceSha256: sha256(en), promptSha256: prompt, translatedAt: '2026-02-01T00:01:00.000Z' }
    Object.assign(paper.translation, { model: secondModel, modelIdentity: identity, parameters: old.parameters,
      status: 'machine', coverage: { complete: 4, total: 4 }, updatedAt: '2026-02-01T00:02:00.000Z', completedAt: '2026-02-01T00:02:00.000Z' })
    paper.statistics.blockCount = 4
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    assert.equal(paper.blocks[0].translation.model, model)
    assert.equal(paper.blocks[0].translation.parameters.temperature, 0.1)
  })
})

test('mixed-model release rejects undeclared models, tampered identities/settings, relabeled historical blocks and malformed history', async () => {
  for (const [change, expected] of [
    [p => { p.blocks[0].translation.model = 'undeclared-model' }, /Block model, identity/],
    [p => { p.blocks[0].translation.modelIdentity.apiModelId = secondModel }, /Block model, identity/],
    [p => { p.blocks[3].translation.modelIdentity = { ...p.blocks[3].translation.modelIdentity, quantization: '8bit' } }, /Block model, identity/],
    [p => { p.blocks[0].translation.parameters = { ...p.blocks[0].translation.parameters, temperature: 0.9 } }, /Block model, identity/],
    [p => { const old = p.blocks[0].translation; const active = p.translation; old.model = active.model; old.modelIdentity = active.modelIdentity; old.parameters = active.parameters }, /Block model, identity/],
    [p => { const block = p.blocks[3].translation; const prior = p.translation.modelHistory[0]; block.model = prior.model; block.modelIdentity = prior.modelIdentity; block.parameters = prior.parameters }, /Block model, identity/],
    [p => { delete p.blocks[0].translation.parameters }, /Block model, identity/],
    [p => { p.translation.modelsUsed.push(model) }, /Invalid declared model history/],
    [p => { p.translation.modelHistory[1].previousModel = 'undeclared-model' }, /Invalid model history entry/],
    [p => { p.translation.modelHistory[1].reason = 'resume-model'; delete p.translation.modelHistory[1].previousModel }, /Invalid model history entry/],
    [p => { p.translation.modelHistory[1].reason = 'initial-model'; delete p.translation.modelHistory[1].previousModel }, /Invalid model history entry/],
    [p => { p.translation.modelHistory[0].coverageAtStart.total = 3 }, /Invalid model history entry/],
    [p => { p.translation.modelHistory.reverse() }, /Invalid model history entry/],
    [p => { p.translation.modelHistory[0].modelIdentity = { apiModelId: model, format: 'incorrect' } }, /Invalid model history entry/],
    [p => { p.translation.modelHistory[1].promptSha256 = sha256('wrong active prompt') }, /Current translation run/],
    [p => { p.translation.modelHistory = p.translation.modelHistory.slice(1) }, /Invalid model history entry|missing from history/],
    [p => { delete p.translation.modelIdentities[model] }, /identity or usage keys/],
    [p => { delete p.translation.modelsUsed }, /Invalid declared model history/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    change(paper); await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
})

test('mixed-model usage accounts for exact declared models and known observations without inventing missing reasoning counters', async () => {
  for (const [change, expected] of [
    [p => { p.translation.usageByModel.unknown = { promptTokens: 1, completionTokens: 1 } }, /identity or usage keys/],
    [p => { delete p.translation.usageByModel[model] }, /identity or usage keys/],
    [p => { p.translation.usageByModel[model].promptTokens = -1 }, /Invalid model token usage/],
    [p => { p.translation.usageByModel[model].completionTokens = 1.5 }, /Invalid model token usage/],
    [p => { delete p.translation.usageByModel[model].completionTokens }, /Invalid model token usage/],
    [p => { p.translation.usageByModel[model].inventedCounter = 0 }, /Invalid model token usage/],
    [p => { p.translation.usage.promptTokens = 14 }, /Aggregate token usage/],
    [p => { delete p.translation.usage.observedReasoningTokens }, /Aggregate token usage/],
    [p => { p.translation.usageByModel[model].promptTokens = Number.MAX_SAFE_INTEGER }, /safe integer range/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    change(paper); await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
  await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    delete paper.translation.usageByModel[secondModel].observedReasoningTokens
    delete paper.translation.usageByModel[secondModel].reasoningUsageResponses
    delete paper.translation.usage.observedReasoningTokens
    delete paper.translation.usage.reasoningUsageResponses
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
  })
})

test('optional response channels preserve actual routing and permit nonzero observed reasoning usage', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    paper.blocks[3].translation.responseChannels = ['content', 'reasoning_content']
    paper.translation.usageByModel[secondModel].observedReasoningTokens = 12
    paper.translation.usage.observedReasoningTokens = 12
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    for (const invalid of [[], ['content', 'content'], ['analysis'], 'reasoning_content']) {
      paper.blocks[3].translation.responseChannels = invalid
      await save()
      await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Invalid recorded response channels/)
    }
  })
})

test('optional request budgets retain actual run limits and allow historical unknown budgets', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    mixedModelFixture(paper)
    const t = paper.translation
    const budget = { maxTokens: 4096, batchSourceCharacters: 3000, maximumCharacters: 3000, maximumRecords: 40,
      maximumUnitCharacters: 6000, maximumContextCharacters: 1200, maximumContextPerBlock: 1200, maximumSingleLongUnitContext: 300 }
    t.parameters.max_tokens = 4096
    t.modelHistory[1].parameters.max_tokens = 4096
    paper.blocks[3].translation.parameters.max_tokens = 4096
    t.requestBudget = structuredClone(budget)
    t.modelHistory[1].requestBudget = structuredClone(budget)
    paper.blocks[3].translation.requestBudget = structuredClone(budget)
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    assert.equal(paper.blocks[0].translation.requestBudget, undefined)
    paper.blocks[3].translation.requestBudget.maximumRecords = 80
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Block model, identity/)
    paper.blocks[3].translation.requestBudget.maximumRecords = 40
    t.requestBudget.maxTokens = 7000
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /translation provenance/)
  })
})

test('assisted drafts retain actual Qwen completion provenance and identical hashed receipts through HTML publication', async () => {
  await fixture(async ({ directory, dataDir, paper, save }) => {
    const { block, receipt } = assistedCorrectionFixture(paper)
    const usage = structuredClone(paper.translation.usageByModel)
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    await verifyReleaseData({ dataDir: exported.output, report: () => {} })
    const metadata = JSON.parse(await readFile(path.join(exported.output, 'papers', paper.id, 'paper.json'), 'utf8'))
    assert.deepEqual(metadata.translation.assistedCorrections[0], receipt)
    assert.deepEqual(metadata.blocks[3].translation.assistedCorrection, receipt)
    assert.deepEqual(metadata.translation.usageByModel, usage)
    assert.equal(block.translation.model, secondModel)
    assert.equal(metadata.translation.usageByModel['gpt-6-luna'], undefined)
    assert.equal(metadata.translation.modelsUsed.includes('gpt-6-luna'), false)
  })
  await fixture(async ({ dataDir, paper, save }) => {
    paper.translation.assistedCorrections = []
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
  })
})

test('assisted-correction receipts reject missing counterparts, unsupported attribution, stale hashes and impossible times', async () => {
  const paired = change => paper => {
    change(paper.translation.assistedCorrections[0])
    paper.blocks[3].translation.assistedCorrection = structuredClone(paper.translation.assistedCorrections[0])
  }
  for (const change of [
    p => { delete p.translation.assistedCorrections },
    p => { p.translation.assistedCorrections = {} },
    p => { delete p.blocks[3].translation.assistedCorrection },
    p => { p.translation.assistedCorrections = [] },
    p => { p.translation.assistedCorrections.push(structuredClone(p.translation.assistedCorrections[0])) },
    p => { p.blocks[3].translation.assistedCorrection.appliedAt = '2026-02-01T00:01:40.000Z' },
    paired(r => { r.id = '' }),
    paired(r => { r.blockId = 'unknown-block' }),
    paired(r => { r.sourceId = 'wrong-source-anchor' }),
    paired(r => { r.method = 'draft-used-as-final-translation' }),
    paired(r => { r.assistingModel = 'unknown-model' }),
    paired(r => { r.assistingProvider = 'LM Studio local API' }),
    paired(r => { r.primaryModel = model }),
    paired(r => { r.sourceSha256 = sha256('different raw source') }),
    paired(r => { r.sourceBlockSha256 = sha256('different source block') }),
    paired(r => { r.draftSha256 = 'not-a-hash' }),
    paired(r => { r.instructionsSha256 = sha256('different correction instructions') }),
    paired(r => { r.appliedAt = 'not-a-timestamp' }),
    paired(r => { r.appliedAt = '2026-02-01T00:00:30.000Z' }),
    paired(r => { r.appliedAt = '2026-02-01T00:02:30.000Z' }),
    paired(r => { delete r.draftSha256 }),
    paired(r => { r.assistingUsage = { promptTokens: 0, completionTokens: 0 } }),
    p => { delete p.blocks[3].translation.reviewCorrection },
    p => { p.blocks[3].translation.reviewCorrection.method = 'unrecorded-guidance' },
    p => { p.blocks[2].translation.assistedCorrection = structuredClone(p.translation.assistedCorrections[0]) },
  ]) await fixture(async ({ dataDir, paper, save }) => {
    assistedCorrectionFixture(paper)
    change(paper)
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /assisted-correction/)
  })
})

test('literal transport versions remain optional historical metadata and cannot leak opaque tokens into final HTML', async () => {
  await fixture(async ({ dataDir, paper, save }) => {
    for (const version of ['opaque-think-delimiters-v1', 'opaque-model-delimiters-v2']) {
      paper.translation.literalTransport = version
      paper.blocks[0].translation.literalTransport = version
      await save()
      await verifyReleaseData({ dataDir, report: () => {} })
    }
    paper.translation.literalTransport = 'unknown-version'
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Invalid recorded literal transport/)
    paper.translation.literalTransport = 'opaque-model-delimiters-v2'
    paper.blocks[0].translation.literalTransport = 'unknown-version'
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Invalid recorded literal transport/)
    paper.blocks[0].translation.literalTransport = 'opaque-model-delimiters-v2'
    paper.blocks[0].zh += '⟪PAPERO_LITERAL_unrestored_0⟫'
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /Unrestored literal transport token/)
  })
})

test('Codex fragment corrections retain original primary-model provenance with exact final body hashes and source indices', async () => {
  await fixture(async ({ directory, dataDir, paper, save }) => {
    const { block, receipt } = fragmentCorrectionFixture(paper)
    const primary = structuredClone(block.translation)
    delete primary.assistedCorrection
    const usage = structuredClone(paper.translation.usageByModel)
    assert.equal(translationUnits(block.en, block.kind).units.length, 6)
    assert.equal(Object.keys(receipt).length, 14)
    assert.equal(block.translation.reviewCorrection, undefined)
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    const exported = await prepareData({ dataDir, outDir: path.join(directory, 'dist'), include: true })
    await verifyReleaseData({ dataDir: exported.output, report: () => {} })
    const metadata = JSON.parse(await readFile(path.join(exported.output, 'papers', paper.id, 'paper.json'), 'utf8'))
    const exportedPrimary = structuredClone(metadata.blocks[3].translation)
    delete exportedPrimary.assistedCorrection
    assert.deepEqual(exportedPrimary, primary)
    assert.deepEqual(metadata.translation.usageByModel, usage)
    assert.equal(metadata.translation.humanReviewed, false)
    assert.equal(metadata.translation.usageByModel['gpt-6-luna'], undefined)
    assert.equal(metadata.blocks[3].translation.assistedCorrection.correctedChineseSha256, sha256(block.zh))
  })
  // A fragment correction may target a historical primary model without
  // relabeling its parameters/history or requiring an LM Studio retranslation.
  await fixture(async ({ dataDir, paper, save }) => {
    assistedCorrectionFixture(paper)
    const historicalBlock = paper.blocks[0]
    const receipt = fragmentCorrectionReceipt(paper, historicalBlock)
    historicalBlock.translation.assistedCorrection = structuredClone(receipt)
    paper.translation.assistedCorrections.push(receipt)
    await save()
    await verifyReleaseData({ dataDir, report: () => {} })
    assert.equal(historicalBlock.translation.model, model)
    assert.equal(paper.translation.model, secondModel)
  })
})

test('Codex fragment receipts reject bad indices, final hashes, attribution, extra API claims and missing counterparts', async () => {
  const paired = change => paper => {
    change(paper.translation.assistedCorrections[0])
    paper.blocks[3].translation.assistedCorrection = structuredClone(paper.translation.assistedCorrections[0])
  }
  for (const change of [
    paired(r => { r.unitIds = [] }),
    paired(r => { r.unitIds = '3' }),
    paired(r => { r.unitIds = ['3', '4'] }),
    paired(r => { r.unitIds = [-1] }),
    paired(r => { r.unitIds = [6] }),
    paired(r => { r.unitIds = [3, 3] }),
    paired(r => { r.unitIds = [4, 3] }),
    paired(r => { r.unitIds = [0.5] }),
    paired(r => { r.unitIds = [Number.MAX_SAFE_INTEGER + 1] }),
    paired(r => { r.previousChineseSha256 = 'not-a-fingerprint' }),
    paired(r => { r.correctedChineseSha256 = sha256('a different final body') }),
    paired(r => { r.draftSha256 = 'not-a-fingerprint' }),
    paired(r => { r.primaryModel = model }),
    paired(r => { r.sourceBlockSha256 = sha256('a different source') }),
    paired(r => { r.assistingProvider = 'LM Studio local API' }),
    paired(r => { r.assistingModel = secondModel }),
    paired(r => { r.instructionsSha256 = prompt }),
    paired(r => { r.parameters = { temperature: 0.1 } }),
    paired(r => { r.usage = { promptTokens: 0, completionTokens: 0 } }),
    paired(r => { delete r.previousChineseSha256 }),
    paired(r => { r.appliedAt = date }),
    p => { delete p.blocks[3].translation.assistedCorrection },
    p => { delete p.translation.assistedCorrections },
    p => { p.blocks[3].translation.assistedCorrection.unitIds = [0] },
  ]) await fixture(async ({ dataDir, paper, save }) => {
    fragmentCorrectionFixture(paper)
    change(paper)
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), /assisted-correction/)
  })
})

test('valid Codex fragment receipts cannot bypass existing equation, code, citation or numeric fidelity guards', async () => {
  for (const [change, expected] of [
    [html => html.replace('<mn>4</mn>', '<mn>5</mn>'), /Equation, code, image or citation changed/],
    [html => html.replace('const count = 4;', 'const count = 5;'), /Equation, code, image or citation changed/],
    [html => html.replace('href="#narrative"', 'href="#new-narrative"'), /Equation, code, image or citation changed/],
    [html => html.replace('8 个批次', '9 个批次'), /translation fidelity failed/],
  ]) await fixture(async ({ dataDir, paper, save }) => {
    const { block, receipt } = fragmentCorrectionFixture(paper)
    block.zh = change(block.zh)
    receipt.correctedChineseSha256 = sha256(block.zh)
    block.translation.assistedCorrection = structuredClone(receipt)
    await save()
    await assert.rejects(verifyReleaseData({ dataDir, report: () => {} }), expected)
  })
})
