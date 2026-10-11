import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { sha256 } from './paper-lib.mjs'

const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const text = value => typeof value === 'string' && !!value.trim()
const https = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[\s\\]/.test(value) } catch { return false }
}

/** The PDF is a source, while source.sha256 binds the complete converted English HTML. */
export function assertPdfProvenance(paper) {
  const source = paper.source
  if (source?.format !== 'pdf') throw new Error(`Missing PDF source format: ${paper.id}.`)
  const pdf = source.pdf, conversion = source.conversion
  if (!pdf || !https(pdf.url) || !fingerprint(pdf.sha256) || !Number.isSafeInteger(pdf.bytes) || pdf.bytes <= 0
    || !Number.isSafeInteger(pdf.pageCount) || pdf.pageCount < 1 || !text(pdf.version)) throw new Error(`Invalid PDF provenance: ${paper.id}.`)
  if (!conversion || conversion.method !== 'pdf-layout-to-semantic-html' || !fingerprint(conversion.englishHtmlSha256)
    || conversion.englishHtmlSha256 !== source.sha256 || !Array.isArray(conversion.tools) || !conversion.tools.length
    || conversion.tools.some(tool => !text(tool?.name) || !text(tool?.version) || !tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters))
    || !conversion.parameters || typeof conversion.parameters !== 'object' || Array.isArray(conversion.parameters)
    || !Array.isArray(conversion.reviewedPdfPages) || !conversion.reviewedPdfPages.length
    || conversion.reviewedPdfPages.some(page => !Number.isSafeInteger(page) || page < 1 || page > pdf.pageCount)
    || !Array.isArray(conversion.notes) || conversion.notes.some(note => !text(note))) throw new Error(`Invalid PDF conversion provenance: ${paper.id}.`)
  const pages = new Set()
  for (const block of paper.blocks) {
    if (!Array.isArray(block.pdfPages) || !block.pdfPages.length
      || block.pdfPages.some(page => !Number.isSafeInteger(page) || page < 1 || page > pdf.pageCount)
      || new Set(block.pdfPages).size !== block.pdfPages.length) throw new Error(`Invalid PDF block page mapping: ${paper.id}/${block.id}.`)
    for (const page of block.pdfPages) pages.add(page)
  }
  if (pages.size !== pdf.pageCount) throw new Error(`PDF conversion omits a source page: ${paper.id}.`)
  if (source.kind === 'official-paper') {
    if (paper.arxivId !== null || !https(source.url) || source.htmlUrl !== source.url || !Number.isFinite(Date.parse(source.publishedAt))) {
      throw new Error(`Invalid official paper source identity: ${paper.id}.`)
    }
  } else if (source.kind === 'arxiv' && pdf.url !== `https://arxiv.org/pdf/${paper.arxivId}`) {
    throw new Error(`PDF source does not match pinned arXiv version: ${paper.id}.`)
  }
}

export async function verifyRawPdf(paper, directory) {
  assertPdfProvenance(paper)
  const bytes = await readFile(path.join(directory, 'source.pdf'))
  if (bytes.length !== paper.source.pdf.bytes || sha256(bytes) !== paper.source.pdf.sha256 || !bytes.subarray(0, 8).toString().startsWith('%PDF-')) {
    throw new Error(`Raw PDF fingerprint or byte count mismatch: ${paper.id}.`)
  }
}
