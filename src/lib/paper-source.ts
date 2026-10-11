import type { CatalogPaper, PaperDocument } from '../types'

type SourceEntry = Pick<CatalogPaper, 'arxivId' | 'sourceKind' | 'sourceUrl' | 'sourceHtmlUrl'>

export function paperSourceName(entry: SourceEntry): string {
  if (entry.sourceKind === 'official-paper') return '官方论文'
  if (entry.arxivId !== null) return `arXiv:${entry.arxivId}`
  return entry.sourceUrl === 'https://kellerjordan.github.io/posts/muon/' ? '作者文章' : '官方文章'
}

export function paperSourceLink(entry: SourceEntry, paper: PaperDocument | null): { url: string; title: string } {
  if (paper?.source.format === 'pdf' && paper.source.pdf) {
    return { url: paper.source.pdf.url, title: '打开英文 PDF 原文' }
  }
  const name = paperSourceName(entry)
  return { url: entry.sourceHtmlUrl, title: entry.arxivId !== null ? '在 arXiv 打开英文 HTML 原文'
    : name === '作者文章' ? '打开作者原文' : name === '官方论文' ? '打开官方论文来源' : '打开官方发布文章' }
}
