import { describe, expect, it } from 'vitest'
import { paperAuthors, shortPaperAuthors } from '../src/lib/paper-bibliography'
import { matchesPaperFilters } from '../src/lib/paper-tags'
import type { CatalogPaper } from '../src/types'
import registry from '../paper-metadata/bibliography.json'

describe('verified paper citation metadata', () => {
  it('shows and searches official author names while retaining frozen extraction provenance', () => {
    const original = { id: 'llama-1-technical-report', arxivId: '2302.13971v1', authors: ['s'] }
    expect(paperAuthors(original)[0]).toBe('Hugo Touvron')
    expect(shortPaperAuthors(original)).toBe('Touvron et al.')
    expect(original.authors).toEqual(['s'])
    const entry = { ...original, title: 'LLaMA', titleZh: null, year: 2023, tags: ['Llama'] } as CatalogPaper
    expect(matchesPaperFilters(entry, 'Hugo Touvron', '', '')).toBe(true)
  })

  it('does not apply an author correction to another version or an ordinary existing paper', () => {
    const mismatch = { id: 'llama-1-technical-report', arxivId: '2302.13971v2', authors: ['Original Author'] }
    expect(paperAuthors(mismatch)).toBe(mismatch.authors)
    const existing = { id: 'attention-is-all-you-need', arxivId: '1706.03762v7', authors: ['Ashish Vaswani'] }
    expect(paperAuthors(existing)).toBe(existing.authors)
    expect(shortPaperAuthors(existing)).toBe('Vaswani')
  })

  it('uses the first credited author when arXiv combines two authors in one node', () => {
    const original = { id: 'adamw-decoupled-weight-decay', arxivId: '1711.05101v3', authors: ['Ilya Loshchilov & Frank Hutter'] }
    expect(shortPaperAuthors(original)).toBe('Loshchilov et al.')
    expect(original.authors).toEqual(['Ilya Loshchilov & Frank Hutter'])
  })

  it('records the exact authoritative version for each new arXiv bibliography without punctuation-only authors', () => {
    expect(Object.keys(registry.papers)).toHaveLength(19)
    for (const paper of Object.values(registry.papers)) {
      expect(paper.sourceUrl).toBe(`https://arxiv.org/abs/${paper.arxivId}`)
      expect(Number.isFinite(Date.parse(paper.verifiedAt))).toBe(true)
      expect(paper.authors.length).toBeGreaterThan(0)
      expect(paper.authors.every(name => /\p{L}/u.test(name))).toBe(true)
    }
  })
})
