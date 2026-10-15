import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { load } from 'cheerio'
import { fileURLToPath } from 'node:url'
import { sha256 } from './paper-lib.mjs'
import { updateCatalog } from './import-paper.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'

// Exact publication metadata, rather than a name-shaped prose heuristic.
export async function annotatePdfAuthorLists(dataDir, id) {
  return withExclusivePaperLock(dataDir, id, async () => {
    const filename = path.join(dataDir, 'papers', id, 'paper.json')
    const paper = JSON.parse(await readFile(filename, 'utf8'))
    if (paper.source.format !== 'pdf') throw Error('Expected a PDF-derived paper')
    const normalize = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim()
    const authorList = normalize(paper.authors.join(', ')), changed = []
    for (const block of paper.blocks) {
      if (block.sectionId !== 'frontmatter' || block.zh) continue
      const $ = load(block.en, {}, false), paragraphs = $('p')
      if (paragraphs.length !== 1 || paragraphs.children().length || normalize(paragraphs.text()) !== authorList) continue
      const previousEnglishSha256 = sha256(block.en)
      paragraphs.wrapInner('<span class="ltx_personname"></span>')
      block.en = $.root().html(); block.zh = block.en
      block.translation = { status: 'preserved', model: null }
      const receipt = { method: 'mark-exact-publication-author-list', tool: 'annotate-pdf-author-lists.mjs', version: '1.0.0',
        blockId: block.id, sourcePdfSha256: paper.source.pdf.sha256, authorsSha256: sha256(JSON.stringify(paper.authors)),
        previousEnglishSha256, englishSha256: sha256(block.en), appliedAt: new Date().toISOString() }
      ;(paper.source.repairs ??= []).push(receipt); changed.push(block.id)
    }
    if (changed.length) {
      const complete = paper.blocks.filter(block => block.zh).length
      paper.translation.coverage = { complete, total: paper.blocks.length }
      paper.translation.status = complete === paper.blocks.length && paper.titleZh ? 'machine' : 'pending'
      paper.translation.updatedAt = new Date().toISOString()
      if (paper.translation.status === 'machine') paper.translation.completedAt = paper.translation.updatedAt
      await writeFile(filename + '.authors-tmp', JSON.stringify(paper, null, 2) + '\n')
      await rename(filename + '.authors-tmp', filename); await updateCatalog(dataDir, paper)
    }
    return changed
  })
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await annotatePdfAuthorLists(process.argv[2], process.argv[3]))
}
