import registry from '../paper-metadata/bibliography.json' with { type: 'json' }

const fields = ['arxivId', 'authors', 'sourceUrl', 'verifiedAt']
const valid = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
  && Array.isArray(value.authors) && value.authors.length && value.authors.every(author => typeof author === 'string' && !!author.trim())
  && Number.isFinite(Date.parse(value.verifiedAt))
const same = (a, b) => fields.every(key => JSON.stringify(a[key]) === JSON.stringify(b[key]))

/** Separate verified citation metadata from the frozen original HTML extraction. */
export function attachPublicationBibliography(paper) {
  if (paper.publicationBibliography !== undefined) { publicationAuthors(paper); return paper }
  const verified = registry.papers[paper.id]
  if (Array.isArray(paper.authors) && !paper.authors.length && valid(verified)
    && paper.arxivId === verified.arxivId && (paper.source.kind || 'arxiv') === 'arxiv' && paper.source.url === verified.sourceUrl) {
    return { ...paper, publicationBibliography: structuredClone(verified) }
  }
  return paper
}

export function publicationAuthors(paper) {
  if (paper.publicationBibliography !== undefined) {
    const declared = paper.publicationBibliography, verified = registry.papers[paper.id]
    if (!Array.isArray(paper.authors) || paper.authors.length || !valid(declared) || !valid(verified) || !same(declared, verified)
      || paper.arxivId !== verified.arxivId || (paper.source.kind || 'arxiv') !== 'arxiv' || paper.source.url !== verified.sourceUrl) {
      throw new Error(`Invalid fixed-version publication bibliography: ${paper.id}.`)
    }
    return declared.authors
  }
  return paper.authors
}
