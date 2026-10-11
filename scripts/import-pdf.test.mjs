import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importConvertedPdf } from './import-pdf.mjs'
import { sanitizeSvg, sha256 } from './paper-lib.mjs'

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-pdf-import-'))
  const convertedDir = path.join(directory, 'converted'), dataDir = path.join(directory, 'data'), pdfFile = path.join(directory, 'source.pdf'), recipeFile = path.join(directory, 'recipe.json')
  await mkdir(path.join(convertedDir, 'assets'), { recursive: true })
  const pdf = Buffer.from('%PDF-1.7 synthetic conversion fixture; no PDF extraction is performed by this test'), recipe = JSON.stringify({ title: 'Official source report' })
  const html = '<!doctype html><html><head><title>Official source report</title></head><body><article><div id="first"><h2>Introduction</h2></div><div id="last"><p>Full second-page source content.</p></div></article></body></html>'
  const conversion = { version: '1.2.0', pdfplumber: 'test-fixture', pypdf: 'test-fixture', inputPdf: { sha256: sha256(pdf), bytes: pdf.length }, recipeSha256: sha256(recipe), englishHtmlSha256: sha256(html),
    coverage: { missing: 0, duplicate: 0, sourceCharacters: 100, excludedSourceCharacters: 0, excludedReason: 'Fixture has no headers', pageCount: 2 },
    resolvedDestinations: { first: { sourceId: 'first', pdfPage: 1 } }, assets: [],
    blocks: [{ sourceId: 'first', kind: 'heading', html: '<div id="first"><h2>Introduction</h2></div>', pdfPages: [1] }, { sourceId: 'last', kind: 'paragraph', html: '<div id="last"><p>Full second-page source content.</p></div>', pdfPages: [2] }] }
  await writeFile(pdfFile, pdf); await writeFile(recipeFile, recipe); await writeFile(path.join(convertedDir, 'source.html'), html); await writeFile(path.join(convertedDir, 'conversion.json'), JSON.stringify(conversion))
  const metadata = { id: 'official-source-report', title: 'Official source report', authors: ['Source Author'], year: 2019, sourceUrl: 'https://publisher.example/report', pdfUrl: 'https://publisher.example/report.pdf', publishedAt: '2019-02-14T00:00:00Z', fetchedAt: '2026-10-11T00:00:00Z', version: 'fixed-source-2019' }
  return { directory, convertedDir, dataDir, pdfFile, recipeFile, metadata, conversion }
}

test('imports complete official PDF conversion with English HTML, source pages and raw fingerprints; preserves existing translations', async () => {
  const f = await fixture()
  try {
    const paper = await importConvertedPdf(f)
    assert.equal(paper.source.kind, 'official-paper'); assert.equal(paper.arxivId, null)
    assert.equal(paper.source.pdf.sha256, sha256(await readFile(f.pdfFile)))
    assert.deepEqual(paper.blocks.map(block => block.pdfPages), [[1], [2]])
    assert.equal(paper.source.sha256, sha256(await readFile(path.join(f.dataDir, 'papers', paper.id, 'en.html'))))
    paper.blocks[1].zh = '<p>Saved existing translation.</p>'
    await writeFile(path.join(f.dataDir, 'papers', paper.id, 'paper.json'), JSON.stringify(paper))
    const preserved = await importConvertedPdf(f)
    assert.equal(preserved.blocks[1].zh, paper.blocks[1].zh)
    assert.equal(JSON.parse(await readFile(path.join(f.dataDir, 'catalog.json'))).papers.length, 1)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test('imports a pinned arXiv PDF without rewriting its identity as an official-paper source', async () => {
  const f = await fixture()
  try {
    f.metadata.id = 'adam-stochastic-optimization'
    f.metadata.title = 'Official source report'
    f.metadata.sourceKind = 'arxiv'
    f.metadata.arxivId = '1412.6980v9'
    f.metadata.version = f.metadata.arxivId
    f.metadata.sourceUrl = 'https://arxiv.org/abs/1412.6980v9'
    f.metadata.htmlUrl = 'https://arxiv.org/html/1412.6980v9'
    f.metadata.pdfUrl = 'https://arxiv.org/pdf/1412.6980v9'
    delete f.metadata.publishedAt
    f.conversion.blocks[0].html = '<div id="first"><h2>Introduction</h2></div>'
    f.conversion.blocks[0].kind = 'heading'
    await writeFile(path.join(f.convertedDir, 'conversion.json'), JSON.stringify(f.conversion))
    const paper = await importConvertedPdf(f)
    assert.equal(paper.arxivId, '1412.6980v9')
    assert.equal(paper.source.kind, 'arxiv')
    assert.equal(paper.source.url, 'https://arxiv.org/abs/1412.6980v9')
    assert.equal(paper.source.htmlUrl, 'https://arxiv.org/html/1412.6980v9')
    assert.equal(paper.source.pdf.url, 'https://arxiv.org/pdf/1412.6980v9')
    assert.equal('publishedAt' in paper.source, false)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test('rejects arXiv PDF metadata whose pinned version or URL pair drifts', async () => {
  for (const change of [metadata => { metadata.pdfUrl = 'https://arxiv.org/pdf/1412.6980v8' }, metadata => { metadata.htmlUrl = 'https://arxiv.org/html/1412.6980' }, metadata => { metadata.version = '1412.6980v8' }, metadata => {
    metadata.arxivId = metadata.version = '1412.6980v0'
    metadata.sourceUrl = 'https://arxiv.org/abs/1412.6980v0'; metadata.htmlUrl = 'https://arxiv.org/html/1412.6980v0'; metadata.pdfUrl = 'https://arxiv.org/pdf/1412.6980v0'
  }]) {
    const f = await fixture()
    try {
      f.metadata.sourceKind = 'arxiv'; f.metadata.arxivId = '1412.6980v9'
      f.metadata.version = f.metadata.arxivId
      f.metadata.sourceUrl = 'https://arxiv.org/abs/1412.6980v9'; f.metadata.htmlUrl = 'https://arxiv.org/html/1412.6980v9'
      f.metadata.pdfUrl = 'https://arxiv.org/pdf/1412.6980v9'; change(f.metadata)
      await assert.rejects(importConvertedPdf(f), /Invalid arXiv PDF identity metadata/)
      await assert.rejects(readFile(path.join(f.dataDir, 'catalog.json')), { code: 'ENOENT' })
    } finally { await rm(f.directory, { recursive: true, force: true }) }
  }
})

test('rejects changed raw PDF, recipe or English HTML after conversion instead of binding false provenance', async () => {
  for (const target of ['pdfFile', 'recipeFile', 'html']) {
    const f = await fixture()
    try {
      const filename = target === 'html' ? path.join(f.convertedDir, 'source.html') : f[target]
      await writeFile(filename, (await readFile(filename)).toString() + 'changed')
      await assert.rejects(importConvertedPdf(f), /fingerprint mismatch/)
      await assert.rejects(readFile(path.join(f.dataDir, 'catalog.json')), { code: 'ENOENT' })
    } finally { await rm(f.directory, { recursive: true, force: true }) }
  }
})

test('rejects missing coverage, an omitted PDF page and broken internal links before exposing a catalog entry', async () => {
  for (const change of [conversion => { conversion.coverage.missing = 1 }, conversion => { conversion.blocks.pop() }, conversion => { conversion.blocks[1].html = '<p><a href="#absent">Broken reference</a></p>' }]) {
    const f = await fixture()
    try {
      change(f.conversion); await writeFile(path.join(f.convertedDir, 'conversion.json'), JSON.stringify(f.conversion))
      await assert.rejects(importConvertedPdf(f), /coverage|omits a source page|Broken converted PDF reference/)
      await assert.rejects(readFile(path.join(f.dataDir, 'catalog.json')), { code: 'ENOENT' })
    } finally { await rm(f.directory, { recursive: true, force: true }) }
  }
})

async function vectorFixture() {
  const f = await fixture()
  const originalSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><path d="M0 0L10 10"/><image href="https://evil.example/track.svg"/></svg>')
  const filename = 'math-p01-0001.svg'
  const sourceHtml = '<!doctype html><html><head><title>Official source report</title></head><body><article><div id="first"><h2>Introduction</h2></div><div id="last"><p>Full second-page source content.</p><img src="assets/math-p01-0001.svg" alt="Original PDF formula"/></div></article></body></html>'
  await writeFile(path.join(f.convertedDir, 'assets', filename), originalSvg)
  await writeFile(path.join(f.convertedDir, 'source.html'), sourceHtml)
  f.conversion.mathMode = 'original-pdf-vectors'
  f.conversion.pdftocairo = '26.05.0'
  f.conversion.vectorMathModuleSha256 = sha256(await readFile(new URL('./pdf_vector_math.py', import.meta.url)))
  f.conversion.englishHtmlSha256 = sha256(sourceHtml)
  f.conversion.blocks[1].html = '<div id="last"><p>Full second-page source content.</p><img src="assets/math-p01-0001.svg" alt="Original PDF formula"/></div>'
  f.conversion.assets = [{ filename, pdfPage: 2, pdfBounds: [10, 20, 30, 40], sha256: sha256(originalSvg), bytes: originalSvg.length,
    method: 'original-pdf-math-vectors', glyphCount: 2, glyphSourceIndices: [42, 43] }]
  await writeFile(path.join(f.convertedDir, 'conversion.json'), JSON.stringify(f.conversion))
  return { ...f, originalSvg, filename }
}

test('imports original PDF math SVGs after sanitizing them and preserves source and sanitized fingerprints separately', async () => {
  const f = await vectorFixture()
  try {
    const paper = await importConvertedPdf(f)
    const asset = paper.assets.find(item => item.filename === f.filename)
    const actual = await readFile(path.join(f.dataDir, 'papers', paper.id, 'assets', f.filename))
    const sanitized = Buffer.from(sanitizeSvg(f.originalSvg.toString('utf8')))
    assert.equal(asset.sha256, sha256(actual))
    assert.equal(asset.sha256, sha256(sanitized))
    assert.equal(asset.sourceSha256, sha256(f.originalSvg))
    assert.equal(asset.conversion.sourcePdfSha256, paper.source.pdf.sha256)
    assert.equal(asset.conversion.method, 'original-pdf-math-vectors')
    assert.equal(asset.conversion.pdfPage, 2)
    assert.deepEqual(asset.conversion.pdfBounds, [10, 20, 30, 40])
    assert.equal(asset.conversion.glyphCount, 2)
    assert.deepEqual(asset.conversion.glyphSourceIndices, [42, 43])
    assert.equal(asset.sanitized, true)
    assert.notEqual(asset.sha256, asset.sourceSha256)
    assert.match(actual.toString('utf8'), /<path\b/)
    assert.doesNotMatch(actual.toString('utf8'), /<script\b|onload=|evil\.example|href="https:/i)
    const catalog = JSON.parse(await readFile(path.join(f.dataDir, 'catalog.json'), 'utf8'))
    assert.equal(catalog.papers.length, 1)
  } finally { await rm(f.directory, { recursive: true, force: true }) }
})

test('rejects incomplete or drifting original PDF vector provenance before exposing a catalog entry', async () => {
  const changes = [
    ['missing vector module SHA', conversion => { delete conversion.vectorMathModuleSha256 }],
    ['mismatched vector module SHA', conversion => { conversion.vectorMathModuleSha256 = sha256('different PDF math module') }],
    ['missing glyph source indices', conversion => { delete conversion.assets[0].glyphSourceIndices }],
    ['glyph count and source indices disagree', conversion => { conversion.assets[0].glyphSourceIndices = [42] }],
    ['invalid glyph source index', conversion => { conversion.assets[0].glyphSourceIndices = [42, -1] }],
    ['missing source page', conversion => { delete conversion.assets[0].pdfPage }],
    ['source page outside the PDF', conversion => { conversion.assets[0].pdfPage = 3 }],
    ['missing source bounds', conversion => { delete conversion.assets[0].pdfBounds }],
    ['invalid source bounds', conversion => { conversion.assets[0].pdfBounds = [10, 20, 5, 40] }],
  ]
  for (const [label, change] of changes) {
    const f = await vectorFixture()
    try {
      change(f.conversion)
      await writeFile(path.join(f.convertedDir, 'conversion.json'), JSON.stringify(f.conversion))
      await assert.rejects(importConvertedPdf(f), /vector|provenance|bounds|source page|module SHA/i, label)
      await assert.rejects(readFile(path.join(f.dataDir, 'catalog.json')), { code: 'ENOENT' }, `${label}: catalog must remain unexposed`)
    } finally { await rm(f.directory, { recursive: true, force: true }) }
  }
})
