import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertPdfProvenance, verifyRawPdf } from './pdf-provenance.mjs'
import { sha256 } from './paper-lib.mjs'

const pdf = Buffer.from('%PDF-1.5\nfixture source bytes\n')
function fixture() {
  return { id: 'official-report', arxivId: null, blocks: [{ id: 'first', pdfPages: [1] }, { id: 'last', pdfPages: [2] }],
    source: { kind: 'official-paper', format: 'pdf', url: 'https://publisher.example/report', htmlUrl: 'https://publisher.example/report',
      sha256: sha256('<article>Complete English HTML</article>'), publishedAt: '2019-02-14',
      pdf: { url: 'https://publisher.example/report.pdf', sha256: sha256(pdf), bytes: pdf.length, pageCount: 2, version: '2019-02-14-publication' },
      conversion: { method: 'pdf-layout-to-semantic-html', englishHtmlSha256: sha256('<article>Complete English HTML</article>'),
        tools: [{ name: 'fixture converter', version: '1', parameters: { readingOrder: 'columns' } }], parameters: { ocr: false },
        reviewedPdfPages: [1, 2], notes: ['Synthetic fixture; no production review claim.'] } } }
}

test('PDF provenance rejects missing source pages, invalid mappings and a stale converted HTML fingerprint', () => {
  assert.doesNotThrow(() => assertPdfProvenance(fixture()))
  for (const change of [paper => { paper.blocks.pop() }, paper => { paper.blocks[0].pdfPages = [3] },
    paper => { paper.source.conversion.englishHtmlSha256 = 'a'.repeat(64) }, paper => { paper.arxivId = '1901.00001v1' },
    paper => { paper.source.pdf.version = '' }, paper => { paper.source.conversion.tools = [] }]) {
    const paper = fixture(); change(paper); assert.throws(() => assertPdfProvenance(paper))
  }
})

test('the retained raw PDF must match both the immutable fingerprint and byte count', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-pdf-source-'))
  try {
    await writeFile(path.join(directory, 'source.pdf'), pdf)
    await verifyRawPdf(fixture(), directory)
    await writeFile(path.join(directory, 'source.pdf'), Buffer.from('%PDF-1.5\ntampered bytes\n'))
    await assert.rejects(verifyRawPdf(fixture(), directory), /fingerprint or byte count/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('arXiv PDF conversion keeps the fixed PDF version instead of a different source', () => {
  const paper = fixture()
  paper.arxivId = '2001.08361v1'
  paper.source.kind = 'arxiv'
  paper.source.pdf.url = `https://arxiv.org/pdf/${paper.arxivId}`
  assert.doesNotThrow(() => assertPdfProvenance(paper))
  paper.source.pdf.url = 'https://arxiv.org/pdf/2001.08361v2'
  assert.throws(() => assertPdfProvenance(paper), /pinned arXiv version/)
})
