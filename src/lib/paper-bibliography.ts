import registry from '../../paper-metadata/bibliography.json'
import type { CatalogPaper } from '../types'

interface VerifiedBibliography { arxivId: string; authors: string[]; sourceUrl: string; verifiedAt: string }
const papers: Record<string, VerifiedBibliography> = registry.papers

/** Official fixed-version citation metadata complements the original HTML extraction. */
export function paperAuthors(paper: Pick<CatalogPaper, 'id' | 'arxivId' | 'authors'>): string[] {
  const verified = papers[paper.id]
  return verified?.arxivId === paper.arxivId ? verified.authors : paper.authors
}

export function shortPaperAuthors(paper: Pick<CatalogPaper, 'id' | 'arxivId' | 'authors'>): string {
  const authors = paperAuthors(paper)
  const first = authors[0]?.split(' ').at(-1) || (paper.arxivId === null ? '官方来源' : 'arXiv')
  return `${first}${authors.length > 1 ? ' et al.' : ''}`
}
