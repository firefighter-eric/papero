import { getPaperDataBaseUrl, PaperDataError, resolvePaperDataUrl, sanitizePaperHtml } from './paper-data'
import type { PaperDataOptions } from './paper-data'
import type { ResearchEntry } from '../types'
import { validateResearchCatalog, validateResearchDocument } from './research-schema.mjs'
import { createResearchVisualRuntime } from './research-visuals.mjs'

const visualKinds = new Set(createResearchVisualRuntime().kinds)

async function fetchText(path: string, options: PaperDataOptions, optional = false) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timer = setTimeout(abort, options.timeoutMs ?? 20_000)
  try {
    const response = await (options.fetcher ?? fetch)(resolvePaperDataUrl(path, options.baseUrl ?? getPaperDataBaseUrl()), { signal: controller.signal })
    if (optional && response.status === 404) return null
    if (!response.ok) throw new PaperDataError('network', `无法读取研究数据（${response.status}）。`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > 3 * 1024 * 1024) throw new Error('研究文档超出大小限制。')
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (controller.signal.aborted) throw new PaperDataError(options.signal?.aborted ? 'aborted' : 'timeout', '研究文档读取已取消或超时。')
    throw error
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
}

export async function loadResearchCatalog(options: PaperDataOptions = {}) {
  const raw = await fetchText('research/catalog.json', options, true)
  // Older data hosts can continue to serve their paper library.
  return raw === null ? { schemaVersion: 1 as const, reports: [] } : validateResearchCatalog(JSON.parse(raw))
}

export async function loadResearchDocument(entry: ResearchEntry, options: PaperDataOptions = {}) {
  validateResearchCatalog({ schemaVersion: 1, reports: [entry] })
  const metadata = validateResearchDocument(JSON.parse((await fetchText(entry.dataPath, options))!), entry)
  const htmlPath = entry.dataPath.replace(/report\.json$/, 'zh.html')
  const html = (await fetchText(htmlPath, options))!
  const bytes = new TextEncoder().encode(html)
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  if (hash !== metadata.content.sha256 || bytes.length !== metadata.content.bytes) throw new Error('研究正文指纹与元数据不一致。')
  const template = document.createElement('template')
  template.innerHTML = html
  const articles = template.content.querySelectorAll('article[data-research-id]')
  if (articles.length !== 1 || articles[0].getAttribute('data-research-id') !== entry.id) throw new Error('研究正文身份不一致。')
  const article = articles[0]
  const ids = Array.from(article.querySelectorAll('[id]'), el => el.id)
  if (new Set(ids).size !== ids.length || metadata.sections.some(s => !ids.includes(s.id))
    || metadata.sources.some(s => !ids.includes(`ref-${s.id}`))) throw new Error('研究正文缺少章节或引用锚点。')
  for (const link of article.querySelectorAll('a[href^="#"]')) {
    if (!ids.includes(link.getAttribute('href')!.slice(1))) throw new Error('研究正文存在断开的内部引用。')
  }
  for (const visual of article.querySelectorAll('[data-research-visual]')) {
    if (visual.tagName !== 'FIGURE' || !visual.id || !visualKinds.has(visual.getAttribute('data-research-visual')!)
      || visual.querySelectorAll(':scope > [data-visual-mount]').length !== 1) throw new Error('研究交互图示标记无效。')
  }
  return { ...metadata, html: sanitizePaperHtml(article.innerHTML, entry.dataPath, options.baseUrl) }
}
