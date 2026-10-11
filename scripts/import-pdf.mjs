import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { sanitizeHtml, sha256, safeId } from './paper-lib.mjs'
import { mergePaperTags } from './paper-tags.mjs'
import { updateCatalog } from './import-paper.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { assertPdfProvenance } from './pdf-provenance.mjs'

const https = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}

/** Import the complete output of convert-pdf.py; no PDF-only entry or textual substitute. */
export async function importConvertedPdf({ convertedDir, pdfFile, recipeFile, metadata, dataDir = process.env.DATA_DIR || 'data' }) {
  if (!safeId(metadata?.id) || typeof metadata.title !== 'string' || !metadata.title.trim()
    || !Array.isArray(metadata.authors) || !metadata.authors.length || metadata.authors.some(author => typeof author !== 'string' || !author.trim())
    || !Number.isSafeInteger(metadata.year) || !https(metadata.sourceUrl) || !https(metadata.pdfUrl)
    || !Number.isFinite(Date.parse(metadata.publishedAt)) || !Number.isFinite(Date.parse(metadata.fetchedAt))
    || typeof metadata.version !== 'string' || !metadata.version.trim()) throw new Error('Invalid official PDF identity metadata')
  return withExclusivePaperLock(dataDir, metadata.id, async () => {
    const directory = path.join(dataDir, 'papers', metadata.id)
    const [pdf, source, recipeBytes, conversion] = await Promise.all([
      readFile(pdfFile), readFile(path.join(convertedDir, 'source.html'), 'utf8'), readFile(recipeFile),
      readFile(path.join(convertedDir, 'conversion.json'), 'utf8').then(JSON.parse),
    ])
    if (!pdf.subarray(0, 8).toString().startsWith('%PDF-')) throw new Error('Source is not a PDF')
    if (conversion.inputPdf?.sha256 !== sha256(pdf) || conversion.inputPdf.bytes !== pdf.length
      || conversion.recipeSha256 !== sha256(recipeBytes) || conversion.englishHtmlSha256 !== sha256(source)) throw new Error('PDF conversion source or recipe fingerprint mismatch')
    const coverage = conversion.coverage
    if (!coverage || coverage.missing !== 0 || coverage.duplicate !== 0 || !coverage.sourceCharacters
      || !Number.isSafeInteger(coverage.pageCount) || !conversion.blocks?.length || !conversion.resolvedDestinations) throw new Error('PDF conversion lacks complete character coverage and reviewed destinations')
    const recipe = JSON.parse(recipeBytes)
    if (recipe.title !== metadata.title || load(source)('title').text() !== metadata.title) throw new Error('Converted PDF title does not match its source identity')
    const sections = [{ id: 'frontmatter', title: 'Paper information', titleZh: '论文信息', level: 2 }]
    let currentSection = sections[0].id
    const blocks = conversion.blocks.map((item, index) => {
      const en = sanitizeHtml(item.html)
      const $ = load(en, {}, false)
      if (!['heading', 'paragraph', 'reference', 'table', 'figure', 'equation'].includes(item.kind)
        || !Array.isArray(item.pdfPages) || !item.pdfPages.length || !item.sourceId || !$.text().trim() && !$('img,math').length) throw new Error('Invalid PDF semantic block')
      if (item.kind === 'heading') {
        const heading = $('h2,h3,h4,h5,h6').first()
        if (!heading.length) throw new Error('PDF heading lacks a semantic level')
        currentSection = item.sourceId
        sections.push({ id: currentSection, title: heading.text().replace(/\s+/g, ' ').trim(), titleZh: null, level: Number(heading[0].name.slice(1)) })
      }
      return { id: `block-${String(index + 1).padStart(3, '0')}`, sourceId: item.sourceId, sectionId: currentSection,
        kind: item.kind, en, zh: null, pdfPages: item.pdfPages, wordCount: $.text().trim().split(/\s+/).filter(Boolean).length }
    })
    const assets = []
    for (const asset of conversion.assets) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(asset.filename)) throw new Error('Invalid converted PDF asset path')
      const bytes = await readFile(path.join(convertedDir, 'assets', asset.filename))
      if (asset.sha256 !== sha256(bytes) || asset.bytes !== bytes.length) throw new Error('Converted PDF figure fingerprint mismatch')
      assets.push({ filename: asset.filename, sourceUrl: `${metadata.pdfUrl}#page=${asset.pdfPage}`, sha256: sha256(bytes), bytes: bytes.length,
        sourceSha256: sha256(pdf), conversion: { pdfPage: asset.pdfPage, pdfBounds: asset.pdfBounds, resolution: 180, method: 'reviewed-figure-crop' } })
    }
    const abstractHeading = blocks.findIndex(block => block.kind === 'heading' && load(block.en, {}, false).text() === 'Abstract')
    const abstract = abstractHeading >= 0 ? load(blocks[abstractHeading + 1].en, {}, false).text().replace(/\s+/g, ' ').trim() : ''
    const scriptFingerprint = sha256(await readFile(new URL('./convert-pdf.py', import.meta.url)))
    const sourceSha256 = sha256(source)
    const paper = { schemaVersion: 1, id: metadata.id, arxivId: null, title: metadata.title, titleZh: null,
      authors: metadata.authors, authorCredits: metadata.authors, year: metadata.year, tags: mergePaperTags(metadata.id), abstract, abstractZh: null,
      source: { kind: 'official-paper', format: 'pdf', url: metadata.sourceUrl, htmlUrl: metadata.sourceUrl,
        fetchedAt: metadata.fetchedAt, publishedAt: metadata.publishedAt, sha256: sourceSha256, license: null, licenseUrl: null,
        pdf: { url: metadata.pdfUrl, sha256: sha256(pdf), bytes: pdf.length, pageCount: coverage.pageCount, version: metadata.version },
        conversion: { method: 'pdf-layout-to-semantic-html', englishHtmlSha256: sourceSha256,
          tools: [{ name: 'papero/convert-pdf.py', version: conversion.version, parameters: { sha256: scriptFingerprint, recipeSha256: sha256(recipeBytes) } },
            { name: 'pdfplumber', version: conversion.pdfplumber, parameters: { textSource: 'positioned-characters', chartResolutionDpi: 180 } },
            { name: 'pypdf', version: conversion.pypdf, parameters: { namedDestinations: 'reviewed-semantic-targets', sourcePageCount: coverage.pageCount } }],
          parameters: { recipeSha256: sha256(recipeBytes), sourceCharacters: coverage.sourceCharacters, excludedSourceCharacters: coverage.excludedSourceCharacters, excludedReason: coverage.excludedReason, missingCharacters: 0, duplicateCharacters: 0,
            tableCount: blocks.filter(block => block.kind === 'table').length, figureCount: assets.length, resolvedDestinations: Object.keys(conversion.resolvedDestinations).length,
            columnOrder: 'reviewed-left-then-right-with-page-footnotes-after-body', ocr: false, humanReviewed: false },
          reviewedPdfPages: Array.from({ length: coverage.pageCount }, (_, index) => index + 1),
          notes: ['Text-bearing PDF; no OCR or whole-page image substitute was used. Semantic layout, formula structure, all table grids, chart bounds and source page mappings were checked against rendered PDF pages.',
            'Named PDF destinations use FitH without a column coordinate; citation targets were resolved using source author, year and title, then bound to reviewed semantic blocks.',
            ...(metadata.id === 'gpt-2-technical-report' ? ['Equation (1) preserves the published s_n terms and product index i exactly, including the source notation inconsistency.'] : []),
            'This is machine-assisted conversion with bounded visual and structural checks; no human review is claimed.'] } },
      translation: { status: 'pending', model: null, coverage: { complete: 0, total: blocks.length }, humanReviewed: false },
      sections, blocks, assets, statistics: { blockCount: blocks.length, sectionCount: sections.length, wordCount: blocks.reduce((count, block) => count + block.wordCount, 0) } }
    assertPdfProvenance(paper)
    const ids = new Set(), links = new Set()
    for (const block of blocks) {
      const $ = load(block.en, {}, false)
      $('[id]').each((_, element) => { const id = $(element).attr('id'); if (ids.has(id)) throw new Error(`Duplicate converted PDF anchor: ${id}`); ids.add(id) })
      $('a[href^="#"]').each((_, element) => links.add($(element).attr('href').slice(1)))
    }
    for (const link of links) if (!ids.has(link)) throw new Error(`Broken converted PDF reference: ${link}`)
    try {
      const existing = JSON.parse(await readFile(path.join(directory, 'paper.json'), 'utf8'))
      if (existing.source.sha256 !== paper.source.sha256 || existing.source.pdf?.sha256 !== paper.source.pdf.sha256) throw new Error('This paper id already contains another converted source; existing data was preserved')
      await updateCatalog(dataDir, existing)
      return existing
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temporary = path.join(dataDir, '.imports', `${metadata.id}-${process.pid}`)
    await mkdir(path.dirname(temporary), { recursive: true })
    await mkdir(temporary, { recursive: false })
    await cp(path.join(convertedDir, 'assets'), path.join(temporary, 'assets'), { recursive: true })
    await writeFile(path.join(temporary, 'source.pdf'), pdf)
    await writeFile(path.join(temporary, 'source.html'), source)
    await writeFile(path.join(temporary, 'en.html'), source)
    await writeFile(path.join(temporary, 'conversion.json'), JSON.stringify(conversion, null, 2) + '\n')
    await writeFile(path.join(temporary, 'layout-recipe.json'), recipeBytes)
    await writeFile(path.join(temporary, 'paper.json'), JSON.stringify(paper, null, 2) + '\n')
    // The paper lock lives inside directory, so install verified files beneath it.
    // Keep paper.json last; a reader never observes a half-installed document.
    await cp(path.join(temporary, 'assets'), path.join(directory, 'assets'), { recursive: true, force: false, errorOnExist: true })
    for (const filename of ['source.pdf', 'source.html', 'en.html', 'conversion.json', 'layout-recipe.json', 'paper.json']) {
      await cp(path.join(temporary, filename), path.join(directory, filename), { force: false, errorOnExist: true })
    }
    await updateCatalog(dataDir, paper)
    console.log(`Imported ${metadata.title}: ${blocks.length} blocks, ${sections.length} sections, ${assets.length} figures, ${coverage.pageCount} source pages.`)
    return paper
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Usage: npm run paper:import-pdf -- --converted-dir DIRECTORY --pdf FILE --recipe FILE --metadata FILE [--data-dir DIRECTORY]\nImports a complete, reviewed PDF-to-English-HTML conversion and its source provenance. Does not translate or publish.')
  } else {
    const value = key => {
      const index = args.indexOf(key)
      if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing required argument ${key}`)
      return args[index + 1]
    }
    try {
      await importConvertedPdf({ convertedDir: value('--converted-dir'), pdfFile: value('--pdf'), recipeFile: value('--recipe'),
        metadata: JSON.parse(await readFile(value('--metadata'), 'utf8')),
        ...(args.includes('--data-dir') ? { dataDir: value('--data-dir') } : {}) })
    } catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
