import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { sanitizeHtml, sha256, safeId, catalogEntry, assertTranslationFidelity, visibleProseText, scientificSignature } from './paper-lib.mjs'
import { verifyRawPdf } from './pdf-provenance.mjs'

export async function verifyData({ dataDir = process.env.DATA_DIR || 'data', strictTranslation = false, requireData = false } = {}) {
  let catalog
  try { catalog = JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT' && !requireData) { console.log('No local paper data. Frontend-only checkout verified; import a paper to inspect its content.'); return { papers: 0, blocks: 0 } }
    throw error
  }
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.papers)) throw new Error('Invalid catalog schema')
  const paperIds = new Set()
  let blockCount = 0
  for (const entry of catalog.papers) {
    if (!safeId(entry.id) || paperIds.has(entry.id)) throw new Error('Invalid or duplicate catalog paper id')
    paperIds.add(entry.id)
    if (entry.dataPath !== `papers/${entry.id}/paper.json`) throw new Error(`Invalid data path for ${entry.id}`)
    const filename = path.join(dataDir, entry.dataPath)
    const paper = JSON.parse(await readFile(filename, 'utf8'))
    const directory = path.dirname(filename)
    if (paper.schemaVersion !== 1 || paper.id !== entry.id || !paper.blocks?.length || !paper.sections?.length) throw new Error(`Invalid paper schema: ${entry.id}`)
    const source = await readFile(path.join(directory, 'source.html'), 'utf8')
    if (sha256(source) !== paper.source.sha256) throw new Error(`Source fingerprint mismatch: ${entry.id}`)
    const sourceKind = paper.source.kind || 'arxiv'
    if (sourceKind === 'arxiv') {
      if (!/^https:\/\/arxiv\.org\/html\//.test(paper.source.htmlUrl) || !/^https:\/\/arxiv\.org\/abs\//.test(paper.source.url)) throw new Error('Source provenance is not arXiv')
    } else if (sourceKind === 'official-article') {
      if (paper.arxivId !== null || paper.source.url !== 'https://qwen.ai/blog?id=qwen3.5' || paper.source.htmlUrl !== paper.source.url) throw new Error('Official Qwen3.5 article provenance is invalid')
    } else if (sourceKind === 'official-paper') {
      if (paper.arxivId !== null || paper.source.format !== 'pdf') throw new Error('Official paper PDF provenance is invalid')
    } else throw new Error(`Unsupported source kind: ${sourceKind}`)
    if (paper.source.format === 'pdf') await verifyRawPdf(paper, directory)
    const sectionIds = new Set(paper.sections.map(section => section.id))
    const blockIds = new Set()
    const sourceIds = new Set()
    const assets = new Set()
    const internalLinks = new Set()
    const complete = paper.blocks.filter(block => block.zh).length
    const translationModels = new Set(paper.translation.modelsUsed || [paper.translation.model].filter(Boolean))
    if (paper.translation.modelHistory && paper.translation.modelHistory.some(run => !translationModels.has(run.model) || run.modelIdentity?.apiModelId !== run.model)) throw new Error(`Invalid translation model history: ${entry.id}`)
    if (paper.translation.coverage?.complete !== complete || paper.translation.coverage?.total !== paper.blocks.length) throw new Error(`Invalid coverage: ${entry.id}`)
    if ((strictTranslation || paper.translation.status === 'machine') && (complete !== paper.blocks.length || !paper.titleZh || !paper.translation.model)) throw new Error(`Translation incomplete: ${complete}/${paper.blocks.length}`)
    for (const block of paper.blocks) {
      if (blockIds.has(block.id) || !sectionIds.has(block.sectionId) || !block.en) throw new Error(`Invalid block: ${block.id}`)
      blockIds.add(block.id)
      for (const language of ['en', 'zh']) {
        const html = block[language]
        if (!html) continue
        if (sanitizeHtml(html) !== html) throw new Error(`Unsafe HTML or noncanonical sanitizer output: ${block.id}/${language}`)
        const $ = load(html, {}, false)
        $('[id]').each((_, element) => sourceIds.add($(element).attr('id')))
        $('img').each((_, image) => assets.add($(image).attr('src')))
        $('a[href^="#"]').each((_, anchor) => internalLinks.add($(anchor).attr('href').slice(1)))
      }
      if (block.zh) {
        const english = load(block.en, {}, false), chinese = load(block.zh, {}, false)
        if (JSON.stringify(scientificSignature(english)) !== JSON.stringify(scientificSignature(chinese))) throw new Error(`Formula, code, figure, or citation changed: ${block.id}`)
        // Check the complete visible prose as well as the preserved DOM. This
        // catches numeric/citation text copied outside its original anchor.
        try { assertTranslationFidelity(visibleProseText(english), visibleProseText(chinese)) } catch (error) { throw new Error(`Translation fidelity failed for ${entry.id}/${block.id}: ${error.message}`) }
      }
      if (block.translation?.sourceSha256 && block.translation.sourceSha256 !== sha256(block.en)) throw new Error(`Stale translated block: ${block.id}`)
      if (block.zh && block.translation?.status === 'machine' && (!translationModels.has(block.translation.model) || block.translation.modelIdentity && block.translation.modelIdentity.apiModelId !== block.translation.model)) throw new Error(`Undeclared translated block model: ${block.id}`)
    }
    for (const sectionId of sectionIds) sourceIds.add(sectionId)
    for (const reference of internalLinks) if (!sourceIds.has(reference)) throw new Error(`Broken internal reference: ${reference}`)
    for (const asset of assets) {
      if (!/^assets\/[a-zA-Z0-9._-]+$/.test(asset ?? '')) throw new Error(`Unsafe asset path: ${asset}`)
      const bytes = await readFile(path.join(directory, asset))
      const record = paper.assets?.find(item => `assets/${item.filename}` === asset)
      if (!record || record.sha256 !== sha256(bytes)) throw new Error(`Asset fingerprint mismatch: ${asset}`)
    }
    const expected = catalogEntry(paper)
    for (const key of ['title', 'titleZh', 'blockCount', 'sectionCount', 'translationStatus']) if (entry[key] !== expected[key]) throw new Error(`Catalog/paper mismatch: ${key}`)
    blockCount += paper.blocks.length
    console.log(`${paper.title}: ${paper.blocks.length} aligned blocks, ${complete} translated, ${assets.size} verified assets, original equations/citations intact.`)
  }
  return { papers: catalog.papers.length, blocks: blockCount }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) verifyData({ strictTranslation: process.argv.includes('--strict-translation'), requireData: process.argv.includes('--require-data') }).catch(error => { console.error(error.message); process.exitCode = 1 })
