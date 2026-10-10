export type TranslationStatus = 'machine' | 'pending'
export type SourceKind = 'arxiv' | 'official-article'

export type PaperBlockKind =
  | 'heading'
  | 'paragraph'
  | 'figure'
  | 'table'
  | 'equation'
  | 'reference'
  | 'list'
  | 'code'

export interface CatalogPaper {
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
  /** A path relative to VITE_PAPER_DATA_URL, never an absolute URL. */
  dataPath: string
}

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
  language?: string
  media?: { kind: 'video'; url: string; sourceId: string }[]
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
