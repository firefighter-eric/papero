import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { updateCatalog } from './import-paper.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { sha256, sanitizeHtml, sanitizeSvg } from './paper-lib.mjs'
import { authorArticleProfile, authorArticleAssetUrl, assertAuthorArticleProvenance,
  prepareAuthorArticleHtml, parseAuthorArticle } from './author-article-lib.mjs'

async function responseBytes(response, limit, label) {
  if (!response.ok) throw new Error(`${label} request failed (${response.status})`)
  if (!response.body) throw new Error(`${label} response body is missing`)
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > limit) throw new Error(`${label} exceeds supported import size`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function atomicJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n')
  await rename(temporary, filename)
}

const blockIdentity = paper => paper.blocks.map(({ id, sourceId, sectionId, kind, en }) => ({ id, sourceId, sectionId, kind, en }))
const sectionIdentity = paper => paper.sections.map(({ id, title, level }) => ({ id, title, level }))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Validate the extraction against its untouched source before local registration. */
export async function registerStagedAuthorArticle(stageDir, dataDir = process.env.DATA_DIR || 'data') {
  const paper = JSON.parse(await readFile(path.join(stageDir, 'paper.json'), 'utf8'))
  const sourceHtml = await readFile(path.join(stageDir, 'source.html'), 'utf8')
  const profile = assertAuthorArticleProvenance(paper, { sourceHtml })
  const prepared = prepareAuthorArticleHtml(sourceHtml, profile)
  const sourceUrls = [...new Set(prepared.content.find('img').map((_, node) => prepared.$(node).attr('src')).get())]
  if (!Array.isArray(paper.assets) || paper.assets.length !== sourceUrls.length
    || new Set(paper.assets.map(asset => asset.filename)).size !== paper.assets.length) throw new Error('Author article staged asset metadata does not match the source')
  for (const asset of paper.assets) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(asset.filename) || !sourceUrls.includes(asset.sourceUrl)
      || authorArticleAssetUrl(asset.sourceUrl, profile) !== asset.sourceUrl) throw new Error('Author article staged asset identity mismatch')
    const raw = await readFile(path.join(stageDir, 'source-assets', asset.filename))
    const bytes = await readFile(path.join(stageDir, 'assets', asset.filename))
    const svg = path.extname(asset.filename) === '.svg'
    if (sha256(raw) !== asset.sourceSha256 || sha256(bytes) !== asset.sha256 || bytes.length !== asset.bytes
      || (svg ? asset.sanitized !== true || !bytes.equals(Buffer.from(sanitizeSvg(raw.toString('utf8')))) : !bytes.equals(raw))) {
      throw new Error(`Author article staged asset fingerprint mismatch: ${asset.filename}`)
    }
  }
  const byUrl = new Map(paper.assets.map(asset => [asset.sourceUrl, asset.filename]))
  prepared.content.find('img').each((_, node) => prepared.$(node).attr('src', `assets/${byUrl.get(prepared.$(node).attr('src'))}`))
  const extracted = parseAuthorArticle(prepared, { id: paper.id, html: sourceHtml, fetchedAt: paper.source.fetchedAt,
    assets: paper.assets, processorSha256: paper.source.extraction.processorSha256 })
  if (!same(blockIdentity(extracted), blockIdentity(paper)) || !same(sectionIdentity(extracted), sectionIdentity(paper))
    || !same(extracted.source.extraction, paper.source.extraction) || !same(extracted.source.revisionNotes, paper.source.revisionNotes)
    || paper.blocks.some(block => sanitizeHtml(block.en) !== block.en)) throw new Error('Author article staged extraction changed')
  return withExclusivePaperLock(dataDir, paper.id, async () => {
    const directory = path.join(dataDir, 'papers', paper.id)
    let existing
    try { existing = JSON.parse(await readFile(path.join(directory, 'paper.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (existing && (existing.source.sha256 !== paper.source.sha256 || !same(blockIdentity(existing), blockIdentity(paper))
      || !same(sectionIdentity(existing), sectionIdentity(paper)) || !same(existing.assets, paper.assets))) {
      throw new Error('Registered author article source, extraction or assets changed; preserve existing translations and choose an explicit migration')
    }
    await mkdir(path.join(directory, 'assets'), { recursive: true })
    await cp(path.join(stageDir, 'assets'), path.join(directory, 'assets'), { recursive: true })
    await cp(path.join(stageDir, 'source-assets'), path.join(directory, 'source-assets'), { recursive: true })
    await cp(path.join(stageDir, 'source.html'), path.join(directory, 'source.html'))
    await cp(path.join(stageDir, 'source-metadata.json'), path.join(directory, 'source-metadata.json'))
    const registered = existing || paper
    await atomicJson(path.join(directory, 'paper.json'), registered)
    await updateCatalog(dataDir, registered)
    return registered
  })
}

export async function importAuthorArticle({ id = 'muon-original-design', stageDir = `.cache/staging/${id}`,
  dataDir = process.env.DATA_DIR || 'data', registerLocal = false, refresh = false, fetcher = fetch } = {}) {
  const profile = authorArticleProfile(id)
  await mkdir(path.join(stageDir, 'assets'), { recursive: true })
  await mkdir(path.join(stageDir, 'source-assets'), { recursive: true })
  let html, fetchedAt, sourceMetadata
  if (!refresh) {
    try {
      html = await readFile(path.join(stageDir, 'source.html'), 'utf8')
      sourceMetadata = JSON.parse(await readFile(path.join(stageDir, 'source-metadata.json'), 'utf8'))
      if (sourceMetadata.url !== profile.url || sourceMetadata.sha256 !== sha256(html)
        || !Number.isFinite(Date.parse(sourceMetadata.fetchedAt))) throw new Error('Cached author article source fingerprint or identity mismatch')
      fetchedAt = sourceMetadata.fetchedAt
    } catch (error) { if (error.code !== 'ENOENT') throw error; html = undefined }
  }
  if (html === undefined) {
    const response = await fetcher(profile.url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Author article source did not return HTML')
    const bytes = await responseBytes(response, 3 * 1024 * 1024, 'Author article')
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    fetchedAt = new Date().toISOString()
    sourceMetadata = { url: profile.url, sha256: sha256(bytes), fetchedAt, assets: [] }
  }
  const prepared = prepareAuthorArticleHtml(html, profile)
  const urls = [...new Set(prepared.content.find('img').map((_, node) => prepared.$(node).attr('src')).get())]
  const assets = []
  for (let start = 0; start < urls.length; start += 4) {
    const batch = await Promise.all(urls.slice(start, start + 4).map(async sourceUrl => {
      const url = new URL(authorArticleAssetUrl(sourceUrl, profile))
      const filename = `${sha256(sourceUrl).slice(0, 16)}-${path.basename(url.pathname)}`
      const record = sourceMetadata.assets?.find(asset => asset.sourceUrl === sourceUrl)
      let raw
      if (!refresh && record) {
        raw = await readFile(path.join(stageDir, 'source-assets', filename))
        const cached = await readFile(path.join(stageDir, 'assets', filename))
        if (record.filename !== filename || sha256(raw) !== record.sourceSha256 || sha256(cached) !== record.sha256
          || cached.length !== record.bytes) throw new Error(`Cached author article asset fingerprint mismatch: ${filename}`)
      } else {
        const response = await fetcher(sourceUrl, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60_000) })
        if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Author article asset did not return an image')
        raw = await responseBytes(response, 20 * 1024 * 1024, 'Author article image')
      }
      const svg = path.extname(filename) === '.svg'
      const bytes = svg ? Buffer.from(sanitizeSvg(raw.toString('utf8'))) : raw
      if (record && !refresh && sha256(bytes) !== record.sha256) throw new Error(`Cached author article SVG sanitizer mismatch: ${filename}`)
      await writeFile(path.join(stageDir, 'source-assets', filename), raw)
      await writeFile(path.join(stageDir, 'assets', filename), bytes)
      return { filename, sourceUrl, sourceSha256: sha256(raw), sha256: sha256(bytes), bytes: bytes.length,
        ...(svg ? { sanitized: true } : {}) }
    }))
    assets.push(...batch)
  }
  const byUrl = new Map(assets.map(asset => [asset.sourceUrl, asset.filename]))
  prepared.content.find('img').each((_, node) => prepared.$(node).attr('src', `assets/${byUrl.get(prepared.$(node).attr('src'))}`))
  const processorSha256 = sha256(Buffer.concat(await Promise.all([
    readFile(new URL('./author-article-lib.mjs', import.meta.url)), readFile(new URL('./import-author-article.mjs', import.meta.url)),
  ])))
  const paper = parseAuthorArticle(prepared, { id, html, fetchedAt, assets, processorSha256 })
  let existing
  try { existing = JSON.parse(await readFile(path.join(stageDir, 'paper.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing?.source.sha256 === paper.source.sha256 && same(blockIdentity(existing), blockIdentity(paper))
    && same(sectionIdentity(existing), sectionIdentity(paper)) && same(existing.assets, paper.assets)) {
    paper.blocks = existing.blocks
    paper.titleZh = existing.titleZh
    paper.abstractZh = existing.abstractZh
    paper.sections = existing.sections
    paper.translation = existing.translation
  }
  await writeFile(path.join(stageDir, 'source.html'), html)
  await atomicJson(path.join(stageDir, 'source-metadata.json'), { ...sourceMetadata, assets })
  await atomicJson(path.join(stageDir, 'paper.json'), paper)
  if (registerLocal) await registerStagedAuthorArticle(stageDir, dataDir)
  console.log(`Staged ${paper.title}: ${paper.blocks.length} blocks, ${paper.sections.length} sections, ${assets.length} assets, ${paper.statistics.mathCount} MathML formulas, ${paper.statistics.codeBlockCount} code blocks.${registerLocal ? ' Registered in the local catalog.' : ''}`)
  return paper
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2)
  const value = option => args.includes(option) ? args[args.indexOf(option) + 1] : undefined
  importAuthorArticle({ id: value('--id'), stageDir: value('--stage-dir'), dataDir: value('--data-dir'),
    registerLocal: args.includes('--register-local'), refresh: args.includes('--refresh') })
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
