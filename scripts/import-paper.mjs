import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'cheerio'
import { catalogEntry, parsePaper, safeId, validArxivId, sha256, sanitizeSvg } from './paper-lib.mjs'
import { withCatalogLock, withExclusivePaperLock } from './catalog-lock.mjs'
import { readArxivSourceAssetRecovery, recoverArxivSourceAsset } from './arxiv-source-assets.mjs'

export async function updateCatalog(dataDir, paper, lockOptions = {}) {
  return withCatalogLock(dataDir, async () => {
    const file = path.join(dataDir, 'catalog.json')
    let catalog = { schemaVersion: 1, papers: [] }
    try { catalog = JSON.parse(await readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const index = catalog.papers.findIndex(item => item.id === paper.id)
    if (index >= 0) catalog.papers[index] = catalogEntry(paper)
    else catalog.papers.push(catalogEntry(paper))
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n')
    await rename(temporary, file)
  }, lockOptions)
}

export async function importArxiv(options) {
  const { arxivId, id, dataDir = process.env.DATA_DIR || 'data' } = options
  if (!validArxivId(arxivId)) throw new Error('Invalid arXiv identifier')
  if (!safeId(id)) throw new Error('Paper id must contain lowercase letters, numbers, and hyphens only')
  return withExclusivePaperLock(dataDir, id, () => importUnlocked({ ...options, dataDir }))
}

async function importUnlocked({ arxivId, id, dataDir, force = false }) {
  if (!validArxivId(arxivId)) throw new Error('Invalid arXiv identifier')
  if (!safeId(id)) throw new Error('Paper id must contain lowercase letters, numbers, and hyphens only')
  const directory = path.join(dataDir, 'papers', id)
  const existingFile = path.join(directory, 'paper.json')
  let existingPaper
  try { existingPaper = JSON.parse(await readFile(existingFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existingPaper && (/v\d+$/.test(arxivId) ? existingPaper.arxivId !== arxivId : existingPaper.arxivId.replace(/v\d+$/, '') !== arxivId)) throw new Error(`Paper id ${id} already contains ${existingPaper.arxivId}. Choose a fresh --id for a different paper or version; existing source and translations were preserved.`)
  await mkdir(path.join(directory, 'assets'), { recursive: true })
  const requestedHtmlUrl = `https://arxiv.org/html/${arxivId}`
  let htmlUrl = requestedHtmlUrl
  const sourceFile = path.join(directory, 'source.html')
  let html
  if (!force) {
    try {
      const cached = await readFile(sourceFile, 'utf8')
      const cachedVersion = load(cached)('#watermark-tr').text().match(/arXiv:([^\s]+v\d+)/)?.[1]
      if (cachedVersion && (/v\d+$/.test(arxivId) ? cachedVersion === arxivId : cachedVersion.replace(/v\d+$/, '') === arxivId)) html = cached
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!html) {
    const response = await fetch(requestedHtmlUrl, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`arXiv HTML unavailable (${response.status}). Import stopped; no fallback or PDF substitute was used.`)
    html = await response.text()
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('arXiv did not return HTML')
  }
  const $ = load(html)
  const sourceVersion = $('#watermark-tr').text().match(/arXiv:([^\s]+v\d+)/)?.[1]
  if (!sourceVersion || (/v\d+$/.test(arxivId) ? sourceVersion !== arxivId : sourceVersion.replace(/v\d+$/, '') !== arxivId)) throw new Error('Downloaded source identity/version does not match the requested arXiv paper')
  if (existingPaper && existingPaper.arxivId !== sourceVersion) throw new Error(`Paper id ${id} already contains ${existingPaper.arxivId}. Choose a fresh --id for ${sourceVersion}; existing source and translations were preserved.`)
  await writeFile(sourceFile, html)
  arxivId = sourceVersion
  htmlUrl = `https://arxiv.org/html/${sourceVersion}`
  const assets = []
  const objects = $('article object')
  objects.each((_, element) => {
    const item = $(element)
    const image = $('<img>').attr({ src: item.attr('data'), alt: 'Refer to caption', id: item.attr('id') || '', width: item.attr('width') || '', height: item.attr('height') || '' })
    item.replaceWith(image)
  })
  for (const image of $('article img').toArray()) {
    const src = $(image).attr('src')
    if (!src) continue
    const url = new URL(src, htmlUrl)
    if (url.hostname !== 'arxiv.org' || !/^\.(png|jpg|jpeg|gif|webp|svg)$/i.test(path.extname(url.pathname))) throw new Error(`Unsupported paper asset: ${url.pathname}`)
    const filename = path.basename(url.pathname)
    const target = path.join(directory, 'assets', filename)
    let bytes
    let recovery = null
    try {
      if (force) { const refresh = new Error('refresh'); refresh.code = 'ENOENT'; throw refresh }
      bytes = await readFile(target)
      if (filename.endsWith('.svg')) {
        const original = await readFile(path.join(directory, 'source-assets', filename))
        if (!bytes.equals(Buffer.from(sanitizeSvg(original.toString('utf8'))))) throw new Error(`Cached sanitized SVG fingerprint mismatch: ${filename}`)
        bytes = original
      }
      recovery = await readArxivSourceAssetRecovery({ directory, arxivId, url, bytes })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
      if (response.status === 404 || response.status === 410) {
        ;({ bytes, recovery } = await recoverArxivSourceAsset({ directory, arxivId, url, status: response.status }))
      } else {
        if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${url}`)
        bytes = Buffer.from(await response.arrayBuffer())
      }
      await writeFile(target, bytes)
    }
    let sourceSha256 = sha256(bytes)
    if (filename.endsWith('.svg')) {
      const originalFile = path.join(directory, 'source-assets', filename)
      await mkdir(path.dirname(originalFile), { recursive: true })
      try {
        if (force) { const refresh = new Error('refresh'); refresh.code = 'ENOENT'; throw refresh }
        sourceSha256 = sha256(await readFile(originalFile))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await writeFile(originalFile, bytes)
      }
      bytes = Buffer.from(sanitizeSvg(bytes.toString('utf8')))
      await writeFile(target, bytes)
    }
    const duplicate = assets.find(asset => asset.filename === filename)
    if (duplicate && duplicate.sourceUrl !== url.href) throw new Error(`Conflicting asset filenames: ${filename}`)
    if (!duplicate) assets.push({ filename, sourceUrl: url.href, sha256: sha256(bytes), sourceSha256, bytes: bytes.length, ...(filename.endsWith('.svg') ? { sanitized: true } : {}), ...(recovery ? { recovery } : {}) })
    $(image).attr('src', `assets/${filename}`)
  }
  const paper = parsePaper($.html(), { id, arxivId, htmlUrl })
  // The fingerprint describes the untouched downloaded source, before local asset rewriting.
  paper.source.sha256 = sha256(html)
  paper.assets = assets
  try {
    const existing = JSON.parse(await readFile(existingFile, 'utf8'))
    if (existing.source.sha256 === paper.source.sha256 && !force) {
      existing.assets = assets
      existing.authors = paper.authors
      existing.authorCredits = paper.authorCredits
      if (!existing.tags?.length) existing.tags = paper.tags
      await writeFile(existingFile, JSON.stringify(existing, null, 2) + '\n')
      console.log(`Source unchanged; preserved ${existing.blocks.filter(block => block.zh).length} translated blocks.`)
      await updateCatalog(dataDir, existing)
      return existing
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await writeFile(existingFile, JSON.stringify(paper, null, 2) + '\n')
  await updateCatalog(dataDir, paper)
  console.log(`Imported ${paper.title}: ${paper.blocks.length} blocks, ${paper.sections.length} sections, ${assets.length} assets.`)
  return paper
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2)
  const arxivId = args.find(value => !value.startsWith('--')) || '1706.03762v7'
  const id = (args.includes('--id') ? args[args.indexOf('--id') + 1] : null) || (arxivId === '1706.03762v7' ? 'attention-is-all-you-need' : `arxiv-${arxivId.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`)
  importArxiv({ arxivId, id, force: args.includes('--force') }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
