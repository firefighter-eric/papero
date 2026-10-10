#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPublication, parseReadingHtml } from './publication-html.mjs'

const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const validAssetName = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)
  && ASSET_EXTENSIONS.has(path.extname(value).toLowerCase())

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

/** Inspect processed files only. Partial translations remain exportable for local development. */
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
  for (const { paper, metadata, dataPath } of papers) {
    if (metadata.content?.format === 'html') continue
    const publication = createPublication(paper)
    generated.set(dataPath, Buffer.from(JSON.stringify(publication.metadata, null, 2) + '\n'))
    for (const language of ['en', 'zh']) generated.set(path.posix.join(path.posix.dirname(dataPath), `${language}.html`), Buffer.from(publication.html[language]))
  }

  const temporary = `${output}.tmp-${process.pid}`
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary, { recursive: true })
  try {
    for (const [relative, fingerprint] of files) {
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
    }
    for (const [relative, bytes] of generated) {
      const destination = path.join(temporary, relative)
      await mkdir(path.dirname(destination), { recursive: true })
      await writeFile(destination, bytes)
    }
    await rm(output, { recursive: true, force: true })
    await rename(temporary, output)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
  const fileCount = files.size + generated.size
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
