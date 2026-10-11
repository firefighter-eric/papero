import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { importConvertedPdf } from './import-pdf.mjs'
import { sha256 } from './paper-lib.mjs'

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
