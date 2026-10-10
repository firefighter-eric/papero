#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { createPublication, parseReadingHtml } from './publication-html.mjs'
import { mergePaperTags } from './paper-tags.mjs'

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const validAssetName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)
  && ASSET_EXTENSIONS.has(path.extname(value).toLowerCase())
const SOURCE_ONLY_KEYS = ['access', 'id', 'arxivId', 'sourceKind', 'title', 'titleZh', 'authors', 'year', 'tags',
  'sourceUrl', 'sourceHtmlUrl', 'translationStatus', 'blockCount', 'sectionCount', 'dataPath', 'abstract', 'abstractZh']
const nonemptyMetadata = value => typeof value === 'string' && !!value.trim() && value.length <= 2_000
const metadataStrings = value => Array.isArray(value) && value.length <= 2_000 && value.every(nonemptyMetadata)

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 8_192 || !/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch { return false }
}

function assertSourceOnlyEntry(entry) {
  if (Object.keys(entry).length !== SOURCE_ONLY_KEYS.length || !SOURCE_ONLY_KEYS.every(key => Object.hasOwn(entry, key))) {
    throw new Error(`Source-only catalog entry has missing or unsupported metadata fields: ${entry.id}.`)
  }
  if (entry.id.length > 160 || !nonemptyMetadata(entry.title) || !metadataStrings(entry.authors) || !entry.authors.length
    || !Number.isSafeInteger(entry.year) || entry.year < 1900 || entry.year > 2200 || !metadataStrings(entry.tags)) {
    throw new Error(`Invalid source-only bibliographic metadata: ${entry.id}.`)
  }
  if (entry.dataPath !== null || entry.blockCount !== 0 || entry.sectionCount !== 0 || entry.translationStatus !== 'pending'
    || entry.titleZh !== null || entry.abstract !== '' || entry.abstractZh !== '') {
    throw new Error(`Source-only catalog entry cannot publish body paths, counts, translated titles or abstracts: ${entry.id}.`)
  }
  if (entry.sourceKind === 'arxiv') {
    if (typeof entry.arxivId !== 'string' || entry.arxivId.length > 160 || !/^\d{4}\.\d{4,5}v[1-9]\d*$/.test(entry.arxivId)
      || entry.sourceUrl !== `https://arxiv.org/abs/${entry.arxivId}` || entry.sourceHtmlUrl !== `https://arxiv.org/html/${entry.arxivId}`) {
      throw new Error(`Invalid pinned source-only arXiv identity: ${entry.id}.`)
    }
  } else if (entry.sourceKind === 'official-article') {
    if (entry.arxivId !== null || !safeHttpsUrl(entry.sourceUrl) || !safeHttpsUrl(entry.sourceHtmlUrl)) {
      throw new Error(`Invalid source-only official article identity or HTTPS URL: ${entry.id}.`)
    }
  } else throw new Error(`Unsupported source-only source kind: ${entry.id}.`)
}

function assertHydrated(bytes, relative) {
  if (/^version https:\/\/git-lfs\.github\.com\/spec\/v1(?:\r?\n|$)/.test(bytes.subarray(0, 256).toString('utf8').trimStart())) {
    throw new Error(`Unhydrated Git LFS pointer: ${relative}. Run git lfs pull, or enable Git LFS in the Vercel project before rebuilding.`)
  }
}

async function readJson(root, relative) {
  const bytes = await readFile(await safeFile(root, relative))
  assertHydrated(bytes, relative)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`Invalid processed JSON: ${relative}.`) }
  return { value, sha256: digest(bytes) }
}

function validateDataPath(value) {
  if (typeof value !== 'string' || !/^papers\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/paper\.json$/.test(value)) {
    throw new Error('Catalog dataPath must be papers/<paper-id>/paper.json.')
  }
  return value
}

async function safeFile(root, relative) {
  const file = await realpath(path.resolve(root, relative))
  if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file)).isFile()) {
    throw new Error(`Paper data file escapes DATA_DIR or is not a file: ${relative}`)
  }
  return file
}

/** Inspect processed files and bibliographic source-only entries without reading their local bodies. Partial translations remain exportable for local development. */
export async function inspectPublicData({ dataDir = process.env.DATA_DIR || 'data' } = {}) {
  const root = await realpath(path.resolve(dataDir))
  const { value: catalog, sha256: catalogHash } = await readJson(root, 'catalog.json')
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.papers)) throw new Error('Invalid paper catalog.')
  const files = new Map([['catalog.json', catalogHash]])
  const ids = new Set()
  const papers = []
  for (const entry of catalog.papers) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || ids.has(entry.id)) throw new Error('Invalid or duplicate paper ID.')
    ids.add(entry.id)
    if (entry.access === 'source-only') {
      assertSourceOnlyEntry(entry)
      papers.push({ entry, paper: null, metadata: null, dataPath: null })
      continue
    }
    if (entry.access !== undefined) throw new Error(`Unsupported catalog access mode: ${entry.id}.`)
    const dataPath = validateDataPath(entry.dataPath)
    if (dataPath !== `papers/${entry.id}/paper.json`) throw new Error(`Catalog data path disagrees with paper ID: ${entry.id}.`)
    const { value: metadata, sha256: paperHash } = await readJson(root, dataPath)
    if (metadata?.schemaVersion !== 1 || metadata.id !== entry.id || !Array.isArray(metadata.blocks)) throw new Error(`Invalid processed paper: ${dataPath}`)
    let paper = metadata
    files.set(dataPath, paperHash)
    if (metadata.content !== undefined) {
      if (metadata.content?.format !== 'html') throw new Error(`Unsupported publication content format: ${entry.id}.`)
      const bodies = {}
      for (const language of ['en', 'zh']) {
        const descriptor = metadata.content[language]
        if (descriptor?.path !== `${language}.html` || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? '')
          || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0) throw new Error(`Invalid publication HTML descriptor: ${entry.id}/${language}.`)
        const relative = path.posix.join(path.posix.dirname(dataPath), descriptor.path)
        const bytes = await readFile(await safeFile(root, relative))
        assertHydrated(bytes, relative)
        if (bytes.length !== descriptor.bytes || digest(bytes) !== descriptor.sha256) throw new Error(`Publication document fingerprint or byte-count mismatch: ${relative}.`)
        let html
        try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error(`Invalid UTF-8 publication document: ${relative}.`) }
        bodies[language] = parseReadingHtml(html, metadata, language)
        files.set(relative, descriptor.sha256)
      }
      paper = { ...metadata, blocks: metadata.blocks.map((block, index) => ({ ...block, en: bodies.en[index].en, zh: bodies.zh[index].zh })) }
    }
    const assetsRelative = path.posix.join(path.posix.dirname(dataPath), 'assets')
    if (!Array.isArray(paper.assets)) throw new Error(`Missing asset metadata: ${entry.id}.`)
    const assetNames = new Set()
    for (const asset of paper.assets) {
      if (!asset || !validAssetName(asset.filename) || assetNames.has(asset.filename)
        || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
        throw new Error(`Invalid or duplicate asset metadata: ${entry.id}.`)
      }
      assetNames.add(asset.filename)
      const relative = path.posix.join(assetsRelative, asset.filename)
      const bytes = await readFile(await safeFile(root, relative))
      assertHydrated(bytes, relative)
      if (digest(bytes) !== asset.sha256 || bytes.length !== asset.bytes) throw new Error(`Asset fingerprint or byte-count mismatch: ${relative}.`)
      files.set(relative, asset.sha256)
    }
    let diskAssets = []
    try { diskAssets = await readdir(path.join(root, assetsRelative), { withFileTypes: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const asset of diskAssets) {
      if (validAssetName(asset.name) && !assetNames.has(asset.name)) throw new Error(`Asset file has no metadata: ${assetsRelative}/${asset.name}.`)
    }
    papers.push({ entry, paper, metadata, dataPath })
  }
  return { root, catalog, papers, files }
}

/** Copy only public processed data. Raw sources and translation checkpoints stay private. */
export async function prepareData({
  dataDir = process.env.DATA_DIR || 'data',
  outDir = 'dist',
  include = process.env.PAPERO_INCLUDE_LOCAL_DATA === '1',
} = {}) {
  const output = path.resolve(outDir, 'paper-data')
  if (!include) {
    await rm(output, { recursive: true, force: true })
    console.log('Local paper data excluded. Configure VITE_PAPER_DATA_URL for a separate data host.')
    return { included: false, paperCount: 0, output }
  }

  const { root, catalog, papers, files } = await inspectPublicData({ dataDir })
  const generated = new Map()
  const excludedAssets = new Set()
  const exportedCatalog = { ...catalog, papers: catalog.papers.map(entry => ({ ...entry, tags: mergePaperTags(entry.id, entry.tags) })) }
  if (JSON.stringify(exportedCatalog) !== JSON.stringify(catalog)) {
    generated.set('catalog.json', Buffer.from(JSON.stringify(exportedCatalog, null, 2) + '\n'))
  }
  for (const { paper, metadata, dataPath } of papers) {
    if (!paper) continue
    const tags = mergePaperTags(paper.id, paper.tags)
    if (metadata.content?.format === 'html') {
      if (JSON.stringify(tags) !== JSON.stringify(metadata.tags)) {
        generated.set(dataPath, Buffer.from(JSON.stringify({ ...metadata, tags }, null, 2) + '\n'))
      }
      continue
    }
    const referencedAssets = new Set()
    for (const block of paper.blocks) for (const language of ['en', 'zh']) {
      const $ = load(block[language] ?? '', {}, false)
      $('img').each((_, node) => {
        const src = $(node).attr('src')
        const filename = typeof src === 'string' && src.startsWith('assets/') ? src.slice('assets/'.length) : null
        if (!validAssetName(filename)) throw new Error(`Invalid asset reference: ${paper.id}/${block.id}.`)
        referencedAssets.add(filename)
      })
    }
    const declaredAssets = new Set(paper.assets.map(asset => asset.filename))
    for (const filename of referencedAssets) {
      if (!declaredAssets.has(filename)) throw new Error(`Referenced asset has no metadata: ${paper.id}/${filename}.`)
    }
    const assets = paper.assets.filter(asset => {
      if (referencedAssets.has(asset.filename)) return true
      excludedAssets.add(path.posix.join(path.posix.dirname(dataPath), 'assets', asset.filename))
      return false
    })
    const publication = createPublication({ ...paper, tags, assets })
    generated.set(dataPath, Buffer.from(JSON.stringify(publication.metadata, null, 2) + '\n'))
    for (const language of ['en', 'zh']) generated.set(path.posix.join(path.posix.dirname(dataPath), `${language}.html`), Buffer.from(publication.html[language]))
  }

  const temporary = `${output}.tmp-${process.pid}`
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  let fileCount = 0
  try {
    for (const [relative, fingerprint] of files) {
      if (excludedAssets.has(relative)) {
        if (digest(await readFile(await safeFile(root, relative))) !== fingerprint) throw new Error(`Processed data changed during export: ${relative}. Retry after ingestion or translation finishes.`)
        continue
      }
      const destination = path.join(temporary, relative)
      await mkdir(path.dirname(destination), { recursive: true })
      if (generated.has(relative)) {
        if (digest(await readFile(await safeFile(root, relative))) !== fingerprint) throw new Error(`Processed data changed during export: ${relative}. Retry after ingestion or translation finishes.`)
        await writeFile(destination, generated.get(relative))
        generated.delete(relative)
      } else {
        await copyFile(await safeFile(root, relative), destination)
        if (digest(await readFile(destination)) !== fingerprint) throw new Error(`Processed data changed during export: ${relative}. Retry after ingestion or translation finishes.`)
      }
      fileCount++
    }
    for (const [relative, bytes] of generated) {
      const destination = path.join(temporary, relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, bytes)
      fileCount++
    }
    await rm(output, { recursive: true, force: true })
    await rename(temporary, output)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
  console.log(`Exported ${catalog.papers.length} papers (${fileCount} files) to ${output}.`)
  return { included: true, paperCount: catalog.papers.length, fileCount, output }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const options = {}
  while (args.length) {
    const argument = args.shift()
    if (argument === '--include') options.include = true
    else if (argument === '--out-dir' && args[0]) options.outDir = args.shift()
    else if (argument === '--data-dir' && args[0]) options.dataDir = args.shift()
    else throw new Error(`Unknown or incomplete argument: ${argument}`)
  }
  await prepareData(options)
}
