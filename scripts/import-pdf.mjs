import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { sanitizeHtml, sanitizeSvg, sha256, safeId } from './paper-lib.mjs'
import { mergePaperTags } from './paper-tags.mjs'
import { updateCatalog } from './import-paper.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { assertPdfProvenance } from './pdf-provenance.mjs'

const https = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}

/** Import the complete output of convert-pdf.py; no PDF-only entry or textual substitute. */
export async function importConvertedPdf({ convertedDir, pdfFile, recipeFile, metadata, dataDir = process.env.DATA_DIR || 'data' }) {
  const arxiv = metadata?.sourceKind === 'arxiv'
  const validArxivId = typeof metadata?.arxivId === 'string' && /^\d{4}\.\d{4,5}v[1-9]\d*$/.test(metadata.arxivId)
  const validIdentity = arxiv
    ? validArxivId && metadata.sourceUrl === `https://arxiv.org/abs/${metadata.arxivId}`
      && metadata.htmlUrl === `https://arxiv.org/html/${metadata.arxivId}`
      && metadata.pdfUrl === `https://arxiv.org/pdf/${metadata.arxivId}` && metadata.version === metadata.arxivId
    : metadata?.sourceKind === undefined && https(metadata?.sourceUrl) && https(metadata?.pdfUrl)
      && Number.isFinite(Date.parse(metadata?.publishedAt))
  if (!safeId(metadata?.id) || typeof metadata.title !== 'string' || !metadata.title.trim()
    || !Array.isArray(metadata.authors) || !metadata.authors.length || metadata.authors.some(author => typeof author !== 'string' || !author.trim())
    || !Number.isSafeInteger(metadata.year) || !validIdentity || !https(metadata.pdfUrl)
    || !Number.isFinite(Date.parse(metadata.fetchedAt))
    || typeof metadata.version !== 'string' || !metadata.version.trim()) throw new Error(`Invalid ${arxiv ? 'arXiv' : 'official'} PDF identity metadata`)
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
    if (conversion.mathMode === 'original-pdf-vectors' && (conversion.vectorMathModuleSha256 !== sha256(await readFile(new URL('./pdf_vector_math.py', import.meta.url)))
      || typeof conversion.pdftocairo !== 'string' || !conversion.pdftocairo.trim())) throw new Error('Invalid PDF vector conversion tool fingerprint')
    if (recipe.title !== metadata.title || load(source)('title').text() !== metadata.title) throw new Error('Converted PDF title does not match its source identity')
    const sections = [{ id: 'frontmatter', title: 'Paper information', titleZh: '论文信息', level: 2 }]
    let currentSection = sections[0].id
    const blocks = conversion.blocks.map((item, index) => {
      const en = sanitizeHtml(item.html)
      const $ = load(en, {}, false)
      if (!['heading', 'paragraph', 'reference', 'table', 'figure', 'equation', 'algorithm'].includes(item.kind)
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
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|svg)$/.test(asset.filename)) throw new Error('Invalid converted PDF asset path')
      const original = await readFile(path.join(convertedDir, 'assets', asset.filename))
      if (asset.sha256 !== sha256(original) || asset.bytes !== original.length) throw new Error('Converted PDF figure fingerprint mismatch')
      const vector = asset.filename.endsWith('.svg')
      const rasterMath = asset.method === 'original-pdf-math-raster'
      if (vector && (conversion.mathMode !== 'original-pdf-vectors' || asset.method !== 'original-pdf-math-vectors'
        || !Number.isSafeInteger(asset.glyphCount) || asset.glyphCount < 1 || !Array.isArray(asset.glyphSourceIndices) || asset.glyphSourceIndices.length !== asset.glyphCount
        || asset.glyphSourceIndices.some(index => !Number.isSafeInteger(index) || index < 0) || new Set(asset.glyphSourceIndices).size !== asset.glyphCount
        || !Number.isSafeInteger(asset.pdfPage) || asset.pdfPage < 1 || asset.pdfPage > coverage.pageCount
        || !Array.isArray(asset.pdfBounds) || asset.pdfBounds.length !== 4 || asset.pdfBounds.some(value => !Number.isFinite(value))
        || asset.pdfBounds[2] <= asset.pdfBounds[0] || asset.pdfBounds[3] <= asset.pdfBounds[1])) throw new Error('Invalid PDF mathematical vector provenance')
      const bytes = vector ? Buffer.from(sanitizeSvg(original.toString('utf8'))) : original
      assets.push({ filename: asset.filename, sourceUrl: `${metadata.pdfUrl}#page=${asset.pdfPage}`, sha256: sha256(bytes), bytes: bytes.length,
        sourceSha256: vector ? sha256(original) : sha256(pdf), ...(vector ? { sanitized: true } : {}), conversion: { pdfPage: asset.pdfPage, pdfBounds: asset.pdfBounds,
          ...(vector || rasterMath ? { method: asset.method, ...(rasterMath ? { resolution: asset.resolution } : {}), sourcePdfSha256: sha256(pdf), glyphCount: asset.glyphCount, glyphSourceIndices: asset.glyphSourceIndices } : { resolution: asset.resolution || 180, method: asset.method || 'reviewed-figure-crop', ...(asset.method === 'reviewed-source-formula-crop' ? { sourcePdfSha256: sha256(pdf) } : {}) }) } })
    }
    const abstractHeading = blocks.findIndex(block => block.kind === 'heading' && load(block.en, {}, false).text() === 'Abstract')
    const abstract = abstractHeading >= 0 ? load(blocks[abstractHeading + 1].en, {}, false).text().replace(/\s+/g, ' ').trim() : ''
    const ocrConverter = conversion.converterScript?.name === 'papero/convert-reviewed-ocr.py' ? conversion.converterScript : null
    if (ocrConverter && (ocrConverter.name !== 'papero/convert-reviewed-ocr.py' || conversion.ocr?.scope !== 'full-pages'
      || ocrConverter.sha256 !== sha256(await readFile(new URL('./convert-reviewed-ocr.py', import.meta.url))))) throw new Error('Invalid reviewed OCR converter identity')
    const scriptFingerprint = sha256(await readFile(new URL(ocrConverter ? './convert-reviewed-ocr.py' : './convert-pdf.py', import.meta.url)))
    if (conversion.converterScript && (conversion.converterScript.name !== (ocrConverter ? 'papero/convert-reviewed-ocr.py' : 'papero/convert-pdf.py') || conversion.converterScript.sha256 !== scriptFingerprint)) throw new Error('PDF converter script fingerprint changed after conversion')
    const sourceSha256 = sha256(source)
    const paper = { schemaVersion: 1, id: metadata.id, arxivId: arxiv ? metadata.arxivId : null, title: metadata.title, titleZh: null,
      authors: metadata.authors, authorCredits: metadata.authors, year: metadata.year, tags: mergePaperTags(metadata.id), abstract, abstractZh: null,
      source: { kind: arxiv ? 'arxiv' : 'official-paper', format: 'pdf', url: metadata.sourceUrl, htmlUrl: arxiv ? metadata.htmlUrl : metadata.sourceUrl,
        fetchedAt: metadata.fetchedAt, ...(arxiv ? {} : { publishedAt: metadata.publishedAt, ...(metadata.publishedAtPrecision ? { publishedAtPrecision: metadata.publishedAtPrecision } : {}) }), sha256: sourceSha256, license: null, licenseUrl: null,
        pdf: { url: metadata.pdfUrl, ...(metadata.retrievalUrl ? { retrievalUrl: metadata.retrievalUrl } : {}), sha256: sha256(pdf), bytes: pdf.length, pageCount: coverage.pageCount, version: metadata.version, ...(recipe.sourceCopy ? { sourceCopy: recipe.sourceCopy } : {}) },
        conversion: { method: 'pdf-layout-to-semantic-html', englishHtmlSha256: sourceSha256,
          tools: [{ name: ocrConverter?.name || 'papero/convert-pdf.py', version: conversion.version, parameters: { sha256: scriptFingerprint, recipeSha256: sha256(recipeBytes) } },
            { name: 'pdfplumber', version: conversion.pdfplumber, parameters: { textSource: ocrConverter ? 'native-layer-coverage-only; reviewed-OCR-supplies-prose' : 'positioned-characters', chartResolutionDpi: ocrConverter ? 'per-asset receipt' : 180 } },
            { name: 'pypdf', version: conversion.pypdf, parameters: { namedDestinations: 'reviewed-semantic-targets', sourcePageCount: coverage.pageCount } }],
          parameters: { recipeSha256: sha256(recipeBytes), sourceCharacters: coverage.sourceCharacters, excludedSourceCharacters: coverage.excludedSourceCharacters, excludedReason: coverage.excludedReason, missingCharacters: 0, duplicateCharacters: 0,
            tableCount: blocks.filter(block => block.kind === 'table').length, figureCount: assets.length, resolvedDestinations: Object.keys(conversion.resolvedDestinations).length,
            columnOrder: 'reviewed-left-then-right-with-page-footnotes-after-body', ocr: conversion.ocr || false, humanReviewed: false },
          reviewedPdfPages: Array.from({ length: coverage.pageCount }, (_, index) => index + 1),
          notes: [conversion.ocr?.scope === 'full-pages'
            ? 'Scanned source pages were transcribed to complete semantic English HTML with page-mapped blocks. Source text layers, OCR responses and hash-bound independent review records were retained in the private work directory. Equations were reviewed as structured MathML or exact local source crops. No whole-page image substitute was used.'
            : conversion.ocr
            ? 'Native PDF text supplies the prose; OCR is limited to table regions without a usable text layer. Recovered table cells were compared against rendered source regions. No whole-page image substitute was used.'
            : 'Text-bearing PDF; no OCR or whole-page image substitute was used. Semantic layout, formula structure, all table grids, chart bounds and source page mappings were checked against rendered PDF pages.',
            'Named PDF destinations use FitH without a column coordinate; citation targets were resolved using source author, year and title, then bound to reviewed semantic blocks.',
            ...(recipe.sourceNotes || []),
            ...(metadata.id === 'gpt-2-technical-report' ? ['Equation (1) preserves the published s_n terms and product index i exactly, including the source notation inconsistency.'] : []),
            'This is machine-assisted conversion with bounded visual and structural checks; no human review is claimed.'] } },
      translation: { status: 'pending', model: null, coverage: { complete: 0, total: blocks.length }, humanReviewed: false },
      sections, blocks, assets, statistics: { blockCount: blocks.length, sectionCount: sections.length, wordCount: blocks.reduce((count, block) => count + block.wordCount, 0) } }
    if (conversion.mathMode === 'original-pdf-vectors') {
      paper.source.conversion.parameters.mathMode = conversion.mathMode
      paper.source.conversion.parameters.mathExpressionCount = assets.filter(asset => asset.conversion.method === 'original-pdf-math-vectors').length
      paper.source.conversion.parameters.figureCount = assets.filter(asset => asset.conversion.method === 'reviewed-figure-crop').length
      paper.source.conversion.tools.push({ name: 'pdftocairo', version: conversion.pdftocairo, parameters: { output: 'svg', scope: 'mathematical-glyph-outlines-and-rules' } },
        { name: 'papero/pdf_vector_math.py', version: conversion.vectorMathVersion || '1.0.0', parameters: { sha256: conversion.vectorMathModuleSha256 } })
      paper.source.conversion.notes.push('Formula glyph mappings or positioned mathematical layouts were unsafe to reconstruct as MathML. Where a reviewed MathML transcription is unavailable, mathematical expressions retain their original PDF vector outlines, or tightly bounded source raster crops when Type3 glyphs cannot be mapped to SVG; surrounding prose, algorithms, references and page mappings remain semantic HTML.')
    }
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
      if (existing.assets.length !== assets.length || existing.assets.some(asset => !assets.some(next => next.filename === asset.filename && next.sha256 === asset.sha256))) throw new Error('Reconversion changed source assets; existing translations were preserved for separate review')
      // A fresh conversion may produce exactly the same English body/assets
      // with updated tool receipts. Keep all accepted translations while binding
      // the latest verified conversion, rather than claiming an old tool ran.
      existing.source = paper.source
      existing.assets = assets
      for (const name of ['conversion.json', 'layout-recipe.json']) {
        await writeFile(path.join(directory, name), name === 'conversion.json' ? JSON.stringify(conversion, null, 2) + '\n' : recipeBytes)
      }
      await writeFile(path.join(directory, 'paper.json'), JSON.stringify(existing, null, 2) + '\n')
      await updateCatalog(dataDir, existing)
      return existing
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temporary = path.join(dataDir, '.imports', `${metadata.id}-${process.pid}`)
    await mkdir(path.dirname(temporary), { recursive: true })
    await mkdir(temporary, { recursive: false })
    await cp(path.join(convertedDir, 'assets'), path.join(temporary, 'assets'), { recursive: true })
    for (const asset of assets.filter(asset => asset.sanitized)) {
      await writeFile(path.join(temporary, 'assets', asset.filename), sanitizeSvg((await readFile(path.join(convertedDir, 'assets', asset.filename))).toString('utf8')))
    }
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
