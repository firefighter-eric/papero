export type TranslationStatus = 'machine' | 'pending'
export type SourceKind = 'arxiv' | 'official-article' | 'official-paper'

export type PaperBlockKind =
  | 'heading'
  | 'paragraph'
  | 'figure'
  | 'table'
  | 'equation'
  | 'reference'
  | 'list'
  | 'code'
  | 'algorithm'

interface CatalogPaperMetadata {
  id: string
  arxivId: string | null
  sourceKind?: SourceKind
  title: string
  titleZh: string | null
  authors: string[]
  year: number
  tags: string[]
  abstract?: string
  abstractZh?: string | null
  sourceUrl: string
  sourceHtmlUrl: string
  translationStatus: TranslationStatus
  blockCount: number
  sectionCount: number
}

export interface FullTextCatalogPaper extends CatalogPaperMetadata {
  access?: undefined
  /** A path relative to VITE_PAPER_DATA_URL, never an absolute URL. */
  dataPath: string
}

/** A bibliographic entry whose full text is retained outside the public library. */
export interface SourceOnlyCatalogPaper extends CatalogPaperMetadata {
  access: 'source-only'
  sourceKind: SourceKind
  titleZh: null
  dataPath: null
  translationStatus: 'pending'
  blockCount: 0
  sectionCount: 0
  abstract: ''
  abstractZh: ''
}

export type CatalogPaper = FullTextCatalogPaper | SourceOnlyCatalogPaper

export interface PaperCatalog {
  schemaVersion: 1
  papers: CatalogPaper[]
}

export interface PaperSection {
  id: string
  title: string
  titleZh: string | null
  level?: number
}

export interface PaperBlock {
  id: string
  sectionId: string
  kind: PaperBlockKind
  /** Source HTML is still sanitized in the reader before display. */
  en: string
  zh: string | null
  sourceId?: string
  wordCount?: number
  /** Original PDF page numbers retained through bilingual HTML export. */
  pdfPages?: number[]
  /** Public HTML publications bind each reconstructed block to its source bytes. */
  contentSha256?: { en: string; zh: string | null }
  /** Inclusive start/exclusive end byte offsets into the complete UTF-8 HTML. */
  contentOffsets?: { en: { start: number; end: number }; zh: { start: number; end: number } }
  translation?: {
    status: 'machine' | 'preserved'
    model: string | null
    sourceSha256?: string
    translatedAt?: string
  }
}

export interface PaperHtmlFile {
  /** A filename in the same directory as the paper metadata. */
  path: 'en.html' | 'zh.html'
  sha256: string
  bytes: number
}

export interface PaperHtmlContent {
  format: 'html'
  en: PaperHtmlFile
  zh: PaperHtmlFile
}

export interface PaperSource {
  kind?: SourceKind
  url: string
  htmlUrl: string
  fetchedAt: string
  sha256: string
  license?: string | null
  licenseUrl?: string | null
  payloadUrl?: string
  publishedAt?: string
  publishedDatePrecision?: 'day'
  author?: string
  publisher?: string
  language?: string
  media?: { kind: 'video'; url: string; sourceId: string }[]
  format?: 'pdf'
  pdf?: { url: string; sha256: string; bytes: number; pageCount: number; version: string }
  conversion?: {
    method: 'pdf-layout-to-semantic-html'
    englishHtmlSha256: string
    tools: { name: string; version: string; parameters: Record<string, unknown> }[]
    parameters: Record<string, unknown>
    reviewedPdfPages: number[]
    notes: string[]
  }
}

export interface PaperTranslation {
  status: TranslationStatus
  model?: string | null
  modelIdentifier?: string | null
  translatedAt?: string | null
  humanReviewed?: boolean
  provider?: string
  method?: string
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  notes?: string[]
  coverage?: { complete: number; total: number }
  parameters?: Record<string, unknown>
  [key: string]: unknown
}

export interface PaperDocument {
  schemaVersion: 1
  id: string
  arxivId: string | null
  title: string
  titleZh: string | null
  authors: string[]
  year: number
  tags: string[]
  abstract?: string | { en: string; zh: string | null }
  abstractZh?: string | null
  sections: PaperSection[]
  blocks: PaperBlock[]
  source: PaperSource
  translation: PaperTranslation
  /** Present for published HTML; the loader reconstructs blocks in memory. */
  content?: PaperHtmlContent
}
