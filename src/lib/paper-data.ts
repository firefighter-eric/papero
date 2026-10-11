import DOMPurify from 'dompurify'
import type {
  CatalogPaper,
  FullTextCatalogPaper,
  PaperBlockKind,
  PaperCatalog,
  PaperDocument,
  PaperHtmlContent,
  PaperHtmlFile,
  SourceKind,
  TranslationStatus,
} from '../types'

export type PaperDataErrorCode = 'missing' | 'network' | 'invalid' | 'timeout' | 'aborted'

export class PaperDataError extends Error {
  readonly code: PaperDataErrorCode

  constructor(code: PaperDataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PaperDataError'
    this.code = code
  }
}

export interface PaperDataOptions {
  baseUrl?: string
  fetcher?: typeof fetch
  timeoutMs?: number
  signal?: AbortSignal
}

const BLOCK_KINDS = new Set<PaperBlockKind>([
  'heading', 'paragraph', 'figure', 'table', 'equation', 'reference', 'list', 'code',
])
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_PAPER_BYTES = 20 * 1024 * 1024
const SOURCE_ONLY_KEYS = new Set([
  'access', 'id', 'arxivId', 'sourceKind', 'title', 'titleZh', 'authors', 'year', 'tags',
  'sourceUrl', 'sourceHtmlUrl', 'translationStatus', 'blockCount', 'sectionCount',
  'dataPath', 'abstract', 'abstractZh',
])

function invalid(message: string): never {
  throw new PaperDataError('invalid', message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string, maxLength = 1_000_000): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength) invalid(`${label} must be a string.`)
}

function nonempty(value: unknown, label: string, maxLength = 2_000): asserts value is string {
  string(value, label, maxLength)
  if (!value.trim()) invalid(`${label} cannot be empty.`)
}

function translatedString(value: unknown, label: string): void {
  if (value !== null) string(value, label)
}

function identifier(value: unknown, label: string): asserts value is string {
  string(value, label, 160)
  if (!ID_PATTERN.test(value)) invalid(`${label} contains invalid characters.`)
}

function strings(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > 2_000) invalid(`${label} must be a string array.`)
  value.forEach((item, index) => nonempty(item, `${label}[${index}]`))
}

function integer(value: unknown, label: string, min = 0, max = 1_000_000): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    invalid(`${label} must be an integer between ${min} and ${max}.`)
  }
}

function status(value: unknown, label: string): asserts value is TranslationStatus {
  if (value !== 'machine' && value !== 'pending') invalid(`${label} is unsupported.`)
}

function httpsUrl(value: unknown, label: string): void {
  nonempty(value, label, 8_192)
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) {
    invalid(`${label} must be an explicit HTTPS URL without whitespace or backslashes.`)
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) invalid(`${label} must use HTTPS.`)
  } catch (error) {
    if (error instanceof PaperDataError) throw error
    invalid(`${label} is not a valid URL.`)
  }
}

/** JSON paths are deliberately restrictive so data cannot escape its storage prefix. */
export function validateDataPath(value: unknown): asserts value is string {
  string(value, 'dataPath', 1_024)
  if (!/^papers\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\.json$/.test(value)) {
    invalid('dataPath must be a relative JSON path inside papers/.')
  }
  if (value.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    invalid('dataPath cannot contain hidden or parent directories.')
  }
}

function sourceKind(value: unknown, label: string): SourceKind {
  if (value === undefined || value === 'arxiv') return 'arxiv'
  if (value === 'official-article' || value === 'official-paper') return value
  return invalid(`${label} is unsupported.`)
}

function validatePaperIdentity(value: Record<string, unknown>, label: string, kind: SourceKind): void {
  identifier(value.id, `${label}.id`)
  if (kind === 'official-article' || kind === 'official-paper') {
    if (value.arxivId !== null) invalid(`${label}.arxivId must be null for an official source.`)
  } else nonempty(value.arxivId, `${label}.arxivId`, 160)
  nonempty(value.title, `${label}.title`)
  translatedString(value.titleZh, `${label}.titleZh`)
  strings(value.authors, `${label}.authors`)
  integer(value.year, `${label}.year`, 1900, 2200)
  strings(value.tags, `${label}.tags`)
}

export function validateCatalog(value: unknown): PaperCatalog {
  const catalog = record(value, 'catalog')
  if (catalog.schemaVersion !== 1) invalid('Unsupported catalog schema version.')
  if (!Array.isArray(catalog.papers) || catalog.papers.length > 10_000) invalid('catalog.papers must be an array.')
  const ids = new Set<string>()
  const paths = new Set<string>()
  catalog.papers.forEach((item, index) => {
    const label = `catalog.papers[${index}]`
    const paper = record(item, label)
    const kind = sourceKind(paper.sourceKind, `${label}.sourceKind`)
    validatePaperIdentity(paper, label, kind)
    httpsUrl(paper.sourceUrl, `${label}.sourceUrl`)
    httpsUrl(paper.sourceHtmlUrl, `${label}.sourceHtmlUrl`)
    status(paper.translationStatus, `${label}.translationStatus`)
    integer(paper.blockCount, `${label}.blockCount`)
    integer(paper.sectionCount, `${label}.sectionCount`)
    if (paper.access === 'source-only') {
      if (Object.keys(paper).some(key => !SOURCE_ONLY_KEYS.has(key))) invalid('Source-only entries contain unsupported metadata fields.')
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(paper.id as string)) invalid('Source-only IDs must use lowercase letters, numbers, and separating hyphens.')
      if (paper.sourceKind === undefined) invalid('Source-only entries must identify their source kind.')
      if (!(paper.authors as string[]).length) invalid('Source-only entries must identify their authors.')
      if (paper.dataPath !== null || paper.blockCount !== 0 || paper.sectionCount !== 0
        || paper.translationStatus !== 'pending') invalid('Source-only entries cannot contain a body path, body counts, or a published translation.')
      if (paper.titleZh !== null || paper.abstract !== '' || paper.abstractZh !== '') {
        invalid('Source-only entries must contain bibliographic metadata without translated titles or abstracts.')
      }
      if (kind === 'arxiv' && (
        !/^\d{4}\.\d{4,5}v[1-9]\d*$/.test(paper.arxivId as string)
        || paper.sourceUrl !== `https://arxiv.org/abs/${paper.arxivId}`
        || paper.sourceHtmlUrl !== `https://arxiv.org/html/${paper.arxivId}`
      )) invalid('Source-only arXiv links must identify the exact fixed paper version.')
    } else {
      if (paper.access !== undefined) invalid(`${label}.access is unsupported.`)
      validateDataPath(paper.dataPath)
    }
    const id = paper.id as string
    if (ids.has(id) || (typeof paper.dataPath === 'string' && paths.has(paper.dataPath))) invalid('Catalog contains a duplicate paper ID or path.')
    ids.add(id)
    if (typeof paper.dataPath === 'string') paths.add(paper.dataPath)
  })
  return value as PaperCatalog
}

export function validatePaper(value: unknown, expected?: CatalogPaper): PaperDocument {
  if (expected?.access === 'source-only') invalid('Source-only entries do not publish a paper document.')
  const paper = record(value, 'paper')
  if (paper.schemaVersion !== 1) invalid('Unsupported paper schema version.')
  const source = record(paper.source, 'paper.source')
  const kind = sourceKind(source.kind, 'paper.source.kind')
  validatePaperIdentity(paper, 'paper', kind)
  if (!Array.isArray(paper.sections) || paper.sections.length > 10_000) invalid('paper.sections must be an array.')
  if (!Array.isArray(paper.blocks) || paper.blocks.length > 100_000) invalid('paper.blocks must be an array.')
  const sectionIds = new Set<string>()
  paper.sections.forEach((item, index) => {
    const section = record(item, `paper.sections[${index}]`)
    identifier(section.id, `paper.sections[${index}].id`)
    nonempty(section.title, `paper.sections[${index}].title`)
    translatedString(section.titleZh, `paper.sections[${index}].titleZh`)
    if (section.level !== undefined) integer(section.level, 'section.level', 1, 6)
    if (sectionIds.has(section.id)) invalid('Paper contains duplicate section IDs.')
    sectionIds.add(section.id)
  })
  const blockIds = new Set<string>()
  paper.blocks.forEach((item, index) => {
    const block = record(item, `paper.blocks[${index}]`)
    identifier(block.id, `paper.blocks[${index}].id`)
    identifier(block.sectionId, `paper.blocks[${index}].sectionId`)
    if (!sectionIds.has(block.sectionId)) invalid('Paper block references an unknown section.')
    if (!BLOCK_KINDS.has(block.kind as PaperBlockKind)) invalid('Paper block kind is unsupported.')
    string(block.en, `paper.blocks[${index}].en`)
    translatedString(block.zh, `paper.blocks[${index}].zh`)
    if (block.sourceId !== undefined) string(block.sourceId, 'block.sourceId', 1_024)
    if (block.wordCount !== undefined) integer(block.wordCount, 'block.wordCount')
    if (blockIds.has(block.id)) invalid('Paper contains duplicate block IDs.')
    blockIds.add(block.id)
  })
  httpsUrl(source.url, 'paper.source.url')
  httpsUrl(source.htmlUrl, 'paper.source.htmlUrl')
  if (source.payloadUrl !== undefined) httpsUrl(source.payloadUrl, 'paper.source.payloadUrl')
  if (source.publishedAt !== undefined) {
    string(source.publishedAt, 'paper.source.publishedAt', 80)
    if (!Number.isFinite(Date.parse(source.publishedAt))) invalid('paper.source.publishedAt must be a date.')
  }
  if (source.language !== undefined) nonempty(source.language, 'paper.source.language', 80)
  if (source.media !== undefined) {
    if (!Array.isArray(source.media) || source.media.length > 2_000) invalid('paper.source.media must be an array.')
    source.media.forEach((item, index) => {
      const medium = record(item, `paper.source.media[${index}]`)
      if (medium.kind !== 'video') invalid('paper.source.media kind is unsupported.')
      httpsUrl(medium.url, `paper.source.media[${index}].url`)
      identifier(medium.sourceId, `paper.source.media[${index}].sourceId`)
    })
  }
  string(source.fetchedAt, 'paper.source.fetchedAt', 80)
  if (!Number.isFinite(Date.parse(source.fetchedAt))) invalid('paper.source.fetchedAt must be a date.')
  string(source.sha256, 'paper.source.sha256', 64)
  if (!/^[a-f0-9]{64}$/i.test(source.sha256)) invalid('paper.source.sha256 must be a SHA-256 hash.')
  if (kind === 'official-paper' && source.format !== 'pdf') invalid('Official papers must declare their PDF conversion source.')
  if (source.format !== undefined) {
    if (source.format !== 'pdf') invalid('paper.source.format is unsupported.')
    const pdf = record(source.pdf, 'paper.source.pdf')
    httpsUrl(pdf.url, 'paper.source.pdf.url')
    nonempty(pdf.version, 'paper.source.pdf.version')
    string(pdf.sha256, 'paper.source.pdf.sha256', 64)
    if (!/^[a-f0-9]{64}$/.test(pdf.sha256 as string)) invalid('paper.source.pdf.sha256 must be a SHA-256 hash.')
    integer(pdf.bytes, 'paper.source.pdf.bytes', 1, Number.MAX_SAFE_INTEGER)
    integer(pdf.pageCount, 'paper.source.pdf.pageCount', 1, 10_000)
    const conversion = record(source.conversion, 'paper.source.conversion')
    if (conversion.method !== 'pdf-layout-to-semantic-html' || conversion.englishHtmlSha256 !== source.sha256) invalid('PDF conversion must bind the source English HTML fingerprint.')
    record(conversion.parameters, 'paper.source.conversion.parameters')
    strings(conversion.notes, 'paper.source.conversion.notes')
    if (!Array.isArray(conversion.tools) || !conversion.tools.length) invalid('PDF conversion must identify its tools.')
    conversion.tools.forEach(item => {
      const tool = record(item, 'paper.source.conversion.tools[]')
      nonempty(tool.name, 'conversion tool name')
      nonempty(tool.version, 'conversion tool version')
      record(tool.parameters, 'conversion tool parameters')
    })
    if (!Array.isArray(conversion.reviewedPdfPages) || !conversion.reviewedPdfPages.length) invalid('PDF conversion must identify visually checked pages.')
    conversion.reviewedPdfPages.forEach(page => integer(page, 'conversion reviewed PDF page', 1, pdf.pageCount as number))
    const mappedPages = new Set<number>()
    paper.blocks.forEach(item => {
      const block = record(item, 'PDF block')
      if (!Array.isArray(block.pdfPages) || !block.pdfPages.length) invalid('PDF block must identify source pages.')
      block.pdfPages.forEach(page => { integer(page, 'block PDF page', 1, pdf.pageCount as number); mappedPages.add(page) })
      if (new Set(block.pdfPages).size !== block.pdfPages.length) invalid('PDF block page mappings must be unique.')
    })
    if (mappedPages.size !== pdf.pageCount) invalid('PDF conversion omits a source page.')
    if (kind === 'official-paper' && (source.htmlUrl !== source.url || !Number.isFinite(Date.parse(source.publishedAt as string)))) invalid('Official paper must identify its publisher source and publication date.')
  }
  const translation = record(paper.translation, 'paper.translation')
  status(translation.status, 'paper.translation.status')
  if (translation.model !== undefined && translation.model !== null) nonempty(translation.model, 'translation.model')
  if (translation.coverage !== undefined) {
    const coverage = record(translation.coverage, 'translation.coverage')
    integer(coverage.complete, 'translation.coverage.complete')
    integer(coverage.total, 'translation.coverage.total')
    if (coverage.complete > coverage.total) invalid('Translation coverage exceeds total blocks.')
  }
  if (paper.abstract !== undefined) {
    if (typeof paper.abstract === 'string') string(paper.abstract, 'paper.abstract')
    else {
      const abstract = record(paper.abstract, 'paper.abstract')
      string(abstract.en, 'paper.abstract.en')
      translatedString(abstract.zh, 'paper.abstract.zh')
    }
  }
  if (expected && (
    paper.id !== expected.id || paper.arxivId !== expected.arxivId
    || kind !== sourceKind(expected.sourceKind, 'catalog.sourceKind')
    || paper.blocks.length !== expected.blockCount || paper.sections.length !== expected.sectionCount
  )) invalid('Paper does not match its catalog entry.')
  return value as PaperDocument
}

export function getPaperDataBaseUrl(): string {
  return import.meta.env.VITE_PAPER_DATA_URL?.trim() || '/paper-data'
}

function browserOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && (
    url.origin === browserOrigin()
    || url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  )
}

export function resolvePaperDataUrl(path: string, baseUrl = getPaperDataBaseUrl()): string {
  if (path !== 'catalog.json') validateDataPath(path)
  return resolveStorageUrl(path, baseUrl)
}

function resolveStorageUrl(path: string, baseUrl = getPaperDataBaseUrl()): string {
  try {
    const base = new URL(baseUrl, browserOrigin())
    if ((base.protocol !== 'https:' && !isLocalHttp(base)) || base.username || base.password || base.search || base.hash) {
      invalid('Paper data URL must be an HTTPS URL or a local path, without credentials, query or fragment.')
    }
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/`
    return new URL(path, base).href
  } catch (error) {
    if (error instanceof PaperDataError) throw error
    invalid('Paper data URL is invalid.')
  }
}

async function fetchText(url: string, options: PaperDataOptions, maxBytes: number, accept: string): Promise<string> {
  if (options.signal?.aborted) throw new PaperDataError('aborted', 'Paper data request was cancelled.')
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timeoutMs = options.timeoutMs ?? 20_000
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1, timeoutMs))
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      signal: controller.signal,
      credentials: 'omit',
      // Revalidate metadata and both HTML documents as one checked publication.
      cache: 'no-cache',
      headers: { Accept: accept },
    })
    if (response.status === 404) throw new PaperDataError('missing', 'Paper data is not available at the configured location.')
    if (!response.ok) throw new PaperDataError('network', `Paper data request failed (${response.status}).`)
    const size = Number(response.headers.get('content-length'))
    if (size > maxBytes) invalid('Paper data response is too large.')
    // Bound the stream before parsing; Content-Length is optional and can be inaccurate.
    let body = ''
    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const decode = (chunk?: Uint8Array, stream = false) => {
        try { return decoder.decode(chunk, { stream }) }
        catch (error) { throw new PaperDataError('invalid', 'Paper data contains invalid UTF-8.', { cause: error }) }
      }
      let bytes = 0
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          invalid('Paper data response is too large.')
        }
        body += decode(value, true)
      }
      body += decode()
    } else {
      body = await response.text()
      if (new TextEncoder().encode(body).byteLength > maxBytes) invalid('Paper data response is too large.')
    }
    return body
  } catch (error) {
    if (error instanceof PaperDataError) throw error
    if (timedOut) throw new PaperDataError('timeout', 'Paper data request timed out.', { cause: error })
    if (options.signal?.aborted) throw new PaperDataError('aborted', 'Paper data request was cancelled.', { cause: error })
    throw new PaperDataError('network', 'Unable to fetch paper data. Check the URL, network, and storage CORS settings.', { cause: error })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
    // Cancel any unread response stream after a size, UTF-8 or status failure.
    controller.abort()
  }
}

async function fetchJson(path: string, options: PaperDataOptions, maxBytes: number): Promise<unknown> {
  const body = await fetchText(resolvePaperDataUrl(path, options.baseUrl), options, maxBytes, 'application/json')
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new PaperDataError('invalid', 'Paper data contains invalid JSON.', { cause: error })
  }
}

function fingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(`${label} must be a SHA-256 hash.`)
}

function validateHtmlMetadata(value: Record<string, unknown>, expected: CatalogPaper): PaperDocument {
  const content = record(value.content, 'paper.content')
  if (content.format !== 'html') invalid('Unsupported paper content format.')
  for (const language of ['en', 'zh'] as const) {
    const file = record(content[language], `paper.content.${language}`)
    if (file.path !== `${language}.html`) invalid(`paper.content.${language}.path must be ${language}.html in the paper directory.`)
    fingerprint(file.sha256, `paper.content.${language}.sha256`)
    integer(file.bytes, `paper.content.${language}.bytes`, 1, MAX_PAPER_BYTES)
  }
  if (!Array.isArray(value.blocks)) invalid('paper.blocks must be an array.')
  const blocks = value.blocks.map((item, index) => {
    const block = record(item, `paper.blocks[${index}]`)
    if ('en' in block || 'zh' in block) invalid('Published HTML metadata cannot also contain block body strings.')
    nonempty(block.sourceId, `paper.blocks[${index}].sourceId`, 1_024)
    const hashes = record(block.contentSha256, `paper.blocks[${index}].contentSha256`)
    fingerprint(hashes.en, `paper.blocks[${index}].contentSha256.en`)
    if (hashes.zh !== null) fingerprint(hashes.zh, `paper.blocks[${index}].contentSha256.zh`)
    const offsets = record(block.contentOffsets, `paper.blocks[${index}].contentOffsets`)
    for (const language of ['en', 'zh'] as const) {
      const offset = record(offsets[language], `paper.blocks[${index}].contentOffsets.${language}`)
      const file = record(content[language], `paper.content.${language}`)
      integer(offset.start, 'HTML block start', 0, file.bytes as number)
      integer(offset.end, 'HTML block end', offset.start, file.bytes as number)
      if ((hashes[language] === null) !== (offset.start === offset.end)) invalid('HTML block offsets disagree with its translation state.')
    }
    return { ...block, en: '', zh: null }
  })
  // Reuse the identity, catalog, sections and provenance checks for both formats.
  return validatePaper({ ...value, blocks }, expected)
}

async function sha256Text(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) invalid('HTML integrity checking requires a secure browser context.')
  const bytes = new TextEncoder().encode(text)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

async function loadHtmlBlocks(
  paper: PaperDocument,
  language: 'en' | 'zh',
  file: PaperHtmlFile,
  entry: FullTextCatalogPaper,
  options: PaperDataOptions,
): Promise<(string | null)[]> {
  const directory = entry.dataPath.slice(0, entry.dataPath.lastIndexOf('/') + 1)
  const url = resolveStorageUrl(`${directory}${file.path}`, options.baseUrl)
  const html = await fetchText(url, options, MAX_PAPER_BYTES, 'text/html')
  const encoded = new TextEncoder().encode(html)
  if (encoded.byteLength !== file.bytes || await sha256Text(html) !== file.sha256) {
    invalid(`The ${language} HTML document does not match its published fingerprint. Reload the paper data.`)
  }
  // Templates are inert: scripts, images and head styles never enter the live page.
  // The existing per-block sanitizer remains the boundary before reader display.
  const template = document.createElement('template')
  template.innerHTML = html
  const articles = template.content.querySelectorAll('article[data-paper-id]')
  const article = articles[0]
  if (articles.length !== 1 || article.getAttribute('data-paper-id') !== paper.id
    || article.getAttribute('data-language') !== language) invalid('HTML document identity does not match the requested paper and language.')
  const wrappers = Array.from(article.children)
  if (wrappers.length !== paper.blocks.length || Array.from(article.childNodes).some(node => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim())) {
    invalid('HTML document has missing or extra paper blocks.')
  }
  const decode = (start: number, end: number) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(encoded.subarray(start, end)) }
    catch (error) { throw new PaperDataError('invalid', 'HTML block offsets split a UTF-8 character.', { cause: error }) }
  }
  const closing = '</div>\n'
  return Promise.all(wrappers.map(async (wrapper, index) => {
    const block = paper.blocks[index]
    if (wrapper.tagName.toLowerCase() !== 'div' || wrapper.getAttribute('data-block-id') !== block.id
      || wrapper.getAttribute('data-block-kind') !== block.kind || wrapper.getAttribute('data-source-id') !== block.sourceId
      || wrapper.getAttribute('data-section-id') !== block.sectionId) invalid('HTML document block order or identity does not match its metadata.')
    // Chromium can escape angle brackets inside attribute values when serializing
    // innerHTML. Preserve and hash the original bytes, never a DOM serialization.
    const { start, end } = block.contentOffsets![language]
    const opening = `<div class="paper-block" data-block-id="${escapeAttribute(block.id)}" data-block-kind="${escapeAttribute(block.kind)}" data-source-id="${escapeAttribute(block.sourceId!)}" data-section-id="${escapeAttribute(block.sectionId)}">`
    const openingBytes = new TextEncoder().encode(opening).byteLength
    const wrapperStart = start - openingBytes
    const preceding = index ? closing : `<article data-paper-id="${escapeAttribute(paper.id)}" data-language="${language}">\n`
    const precedingBytes = new TextEncoder().encode(preceding).byteLength
    if (wrapperStart < precedingBytes || decode(wrapperStart, start) !== opening || decode(end, end + closing.length) !== closing
      || (index ? wrapperStart !== paper.blocks[index - 1].contentOffsets![language].end + closing.length
        : decode(wrapperStart - precedingBytes, wrapperStart) !== preceding)
      || (index === paper.blocks.length - 1 && decode(end + closing.length, end + closing.length + '</article>'.length) !== '</article>')) {
      invalid('HTML block offsets do not match its ordered wrapper boundaries.')
    }
    const body = decode(start, end)
    const hash = block.contentSha256![language]
    if (hash === null) {
      if (language !== 'zh' || body !== '') invalid('Untranslated HTML block must have an empty Chinese wrapper.')
      return null
    }
    if (await sha256Text(body) !== hash) invalid(`HTML block fingerprint does not match its metadata: ${block.id}/${language}.`)
    return body
  }))
}

export async function loadCatalog(options: PaperDataOptions = {}): Promise<PaperCatalog> {
  return validateCatalog(await fetchJson('catalog.json', options, MAX_CATALOG_BYTES))
}

export async function loadPaper(entry: CatalogPaper, options: PaperDataOptions = {}): Promise<PaperDocument> {
  // Also protect direct callers that did not obtain this entry from loadCatalog.
  validateCatalog({ schemaVersion: 1, papers: [entry] })
  if (entry.access === 'source-only') invalid('Source-only entries do not publish a paper document.')
  const value = record(await fetchJson(entry.dataPath, options, MAX_PAPER_BYTES), 'paper')
  if (value.content === undefined) return validatePaper(value, entry)
  const paper = validateHtmlMetadata(value, entry)
  const content = paper.content as PaperHtmlContent
  const [en, zh] = await Promise.all([
    loadHtmlBlocks(paper, 'en', content.en, entry, options),
    loadHtmlBlocks(paper, 'zh', content.zh, entry, options),
  ])
  if (options.signal?.aborted) throw new PaperDataError('aborted', 'Paper data request was cancelled.')
  return validatePaper({ ...paper, blocks: paper.blocks.map((block, index) => ({ ...block, en: en[index], zh: zh[index] })) }, entry)
}

function safeResourceUrl(value: string, paperUrl: string, image: boolean): string | null {
  if (!image && /^#[^\s]*$/.test(value)) return value
  try {
    const url = new URL(value, paperUrl)
    if (url.username || url.password) return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === new URL(paperUrl).origin)) return null
    return url.href
  } catch {
    return null
  }
}

/** Preserve academic HTML and MathML while removing scripts, CSS and unsafe URLs. */
export function sanitizePaperHtml(html: string, dataPath: string, baseUrl = getPaperDataBaseUrl()): string {
  const paperUrl = resolvePaperDataUrl(dataPath, baseUrl)
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'annotation', 'annotation-xml'],
    // MathML annotations contain source metadata, not another visible formula.
    // Disallowed tags normally unwrap their children; drop these subtrees while
    // preserving DOMPurify's default forbidden-content protections.
    ADD_FORBID_CONTENTS: ['annotation', 'annotation-xml'],
    ADD_ATTR: ['alttext'],
    FORBID_ATTR: ['style', 'srcset', 'ping', 'autofocus'],
    RETURN_DOM_FRAGMENT: true,
  })
  fragment.querySelectorAll('[href], [src], [xlink\\:href]').forEach((element) => {
    for (const attribute of ['href', 'src', 'xlink:href']) {
      const value = element.getAttribute(attribute)
      if (value === null) continue
      const safe = safeResourceUrl(value, paperUrl, attribute === 'src')
      if (safe) element.setAttribute(attribute, safe)
      else element.removeAttribute(attribute)
    }
    if (element.tagName.toLowerCase() === 'a' && !element.getAttribute('href')?.startsWith('#')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
  })
  fragment.querySelectorAll('img').forEach((img) => {
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
    img.setAttribute('referrerpolicy', 'no-referrer')
  })
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}
