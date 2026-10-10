import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { updateCatalog } from './import-paper.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { sha256, sanitizeSvg } from './paper-lib.mjs'
import { articlePayload, prepareArticleHtml, parseQwenArticle, publicAssetUrl, QWEN_ARTICLE_ID, QWEN_ARTICLE_URL, QWEN_ARTICLE_PAYLOAD_URL } from './qwen-blog-lib.mjs'

async function responseBytes(response, limit, label) {
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limit) throw new Error(`${label} exceeds the supported import size`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Registration is explicit and shares the translator's exclusive per-paper ownership. */
export async function publishStagedArticle(stageDir, dataDir = process.env.DATA_DIR || 'data') {
  const paper = JSON.parse(await readFile(path.join(stageDir, 'paper.json'), 'utf8'))
  if (paper.id !== QWEN_ARTICLE_ID || paper.arxivId !== null || paper.source.kind !== 'official-article'
    || paper.source.url !== QWEN_ARTICLE_URL || paper.source.htmlUrl !== QWEN_ARTICLE_URL) throw new Error('Staged data is not the official Qwen3.5 article')
  if (sha256(await readFile(path.join(stageDir, 'source.html'), 'utf8')) !== paper.source.sha256) throw new Error('Staged article source fingerprint mismatch')
  for (const asset of paper.assets || []) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(asset.filename)
      || sha256(await readFile(path.join(stageDir, 'assets', asset.filename))) !== asset.sha256) throw new Error('Staged article asset fingerprint mismatch')
  }
  return withExclusivePaperLock(dataDir, paper.id, () => registerValidatedArticle(stageDir, dataDir, paper))
}

async function registerValidatedArticle(stageDir, dataDir, paper) {
  const directory = path.join(dataDir, 'papers', paper.id)
  let existing
  try { existing = JSON.parse(await readFile(path.join(directory, 'paper.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing && existing.source.sha256 !== paper.source.sha256) throw new Error('The registered article source changed; preserve existing translations and choose an explicit migration before replacing it')
  if (existing) {
    const blockSignature = value => value.blocks.map(({ id, sourceId, sectionId, kind, en }) => ({ id, sourceId, sectionId, kind, en }))
    const sectionSignature = value => value.sections.map(({ id, title, level }) => ({ id, title, level }))
    if (JSON.stringify(blockSignature(existing)) !== JSON.stringify(blockSignature(paper))
      || JSON.stringify(sectionSignature(existing)) !== JSON.stringify(sectionSignature(paper))) {
      throw new Error('The staged article extraction changed; preserve existing translations and choose an explicit migration before replacing blocks or sections')
    }
  }
  await mkdir(directory, { recursive: true })
  await cp(path.join(stageDir, 'assets'), path.join(directory, 'assets'), { recursive: true })
  await cp(path.join(stageDir, 'source.html'), path.join(directory, 'source.html'))
  // Preserve translated content when re-registering the same exact source.
  const registered = existing || paper
  registered.assets = paper.assets
  await writeFile(path.join(directory, 'paper.json'), JSON.stringify(registered, null, 2) + '\n')
  await updateCatalog(dataDir, registered)
  return registered
}

export async function importQwenBlog({ stageDir = `.cache/staging/${QWEN_ARTICLE_ID}`, refresh = false, publishLocal = false,
  dataDir = process.env.DATA_DIR || 'data', fetcher = fetch } = {}) {
  await mkdir(path.join(stageDir, 'assets'), { recursive: true })
  let source
  const metadataPath = path.join(stageDir, 'source-metadata.json')
  if (!refresh) {
    try {
      const [html, metadata] = await Promise.all([readFile(path.join(stageDir, 'source.html'), 'utf8'), readFile(metadataPath, 'utf8')])
      const parsed = JSON.parse(metadata)
      if (parsed.title && parsed.sha256 === sha256(html)) source = { html, metadata: parsed }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!source) {
    const response = await fetcher(QWEN_ARTICLE_PAYLOAD_URL, { credentials: 'omit', signal: AbortSignal.timeout(60_000) })
    const bytes = await responseBytes(response, 3 * 1024 * 1024, 'Official article')
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Public Qwen API did not return JSON')
    source = articlePayload(JSON.parse(bytes.toString('utf8')))
    await writeFile(path.join(stageDir, 'source.html'), source.html)
    await writeFile(metadataPath, JSON.stringify({ ...source.metadata, sha256: sha256(source.html), fetchedAt: new Date().toISOString() }, null, 2) + '\n')
  }
  const prepared = prepareArticleHtml(source.html)
  const urls = [...new Set(prepared.content.find('img').map((_, node) => prepared.$(node).attr('src')).get())]
  const assets = []
  for (let offset = 0; offset < urls.length; offset += 4) {
    const batch = await Promise.all(urls.slice(offset, offset + 4).map(async src => {
      const url = new URL(publicAssetUrl(src))
      const extension = path.extname(url.pathname).toLowerCase()
      if (!/^\.(png|jpe?g|gif|webp|avif|svg)$/.test(extension)) throw new Error(`Unsupported image format: ${url.pathname}`)
      const basename = path.basename(url.pathname).replace(/[^a-zA-Z0-9._-]/g, '_')
      const filename = `${sha256(url.href).slice(0, 16)}-${basename}`
      const target = path.join(stageDir, 'assets', filename)
      const originalTarget = path.join(stageDir, 'source-assets', filename)
      let bytes
      if (!refresh) {
        try { bytes = await readFile(extension === '.svg' ? originalTarget : target) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      if (!bytes) {
        const response = await fetcher(url.href, { credentials: 'omit', signal: AbortSignal.timeout(60_000), redirect: 'error' })
        if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Official asset is not an image: ${url.pathname}`)
        bytes = await responseBytes(response, 20 * 1024 * 1024, 'Official image')
      }
      const sourceSha256 = sha256(bytes)
      if (extension === '.svg') {
        await mkdir(path.dirname(originalTarget), { recursive: true })
        await writeFile(originalTarget, bytes)
        bytes = Buffer.from(sanitizeSvg(bytes.toString('utf8')))
      }
      await writeFile(target, bytes)
      return { filename, sourceUrl: url.href, sha256: sha256(bytes), sourceSha256, bytes: bytes.length, ...(extension === '.svg' ? { sanitized: true } : {}) }
    }))
    assets.push(...batch)
  }
  const byUrl = new Map(assets.map(asset => [asset.sourceUrl, asset.filename]))
  prepared.content.find('img').each((_, node) => prepared.$(node).attr('src', `assets/${byUrl.get(prepared.$(node).attr('src'))}`))
  const paper = parseQwenArticle(prepared, { ...source, fetchedAt: source.metadata.fetchedAt || new Date().toISOString(), assets })
  let existing
  try { existing = JSON.parse(await readFile(path.join(stageDir, 'paper.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing?.source.sha256 === paper.source.sha256 && JSON.stringify(existing.blocks.map(block => block.en)) === JSON.stringify(paper.blocks.map(block => block.en))) {
    paper.blocks = existing.blocks
    paper.titleZh = existing.titleZh
    paper.abstractZh = existing.abstractZh
    const translatedSections = new Map(existing.sections.map(section => [section.id, section.titleZh]))
    paper.sections = paper.sections.map(section => ({ ...section, titleZh: translatedSections.get(section.id) || null }))
    paper.translation = existing.translation
  }
  await writeFile(path.join(stageDir, 'paper.json'), JSON.stringify(paper, null, 2) + '\n')
  if (publishLocal) await publishStagedArticle(stageDir, dataDir)
  console.log(`Staged official article: ${paper.blocks.length} blocks, ${paper.sections.length} sections, ${assets.length} images, ${paper.statistics.tableCount} tables, ${paper.statistics.mathCount} formulas, ${paper.source.media.length} video links.`)
  console.log(`Output: ${stageDir}${publishLocal ? ' (registered in local catalog)' : ' (catalog unchanged)'}`)
  return paper
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2)
  const stageDir = args.includes('--stage-dir') ? args[args.indexOf('--stage-dir') + 1] : undefined
  importQwenBlog({ stageDir, refresh: args.includes('--refresh'), publishLocal: args.includes('--publish-local') })
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
