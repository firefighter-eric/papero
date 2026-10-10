import { load } from 'cheerio'
import katex from 'katex'
import { sanitizeHtml, sha256 } from './paper-lib.mjs'
import { mergePaperTags } from './paper-tags.mjs'

export const QWEN_ARTICLE_ID = 'qwen3-5-official-article'
export const QWEN_ARTICLE_URL = 'https://qwen.ai/blog?id=qwen3.5'
export const QWEN_ARTICLE_PAYLOAD_URL = 'https://qwen.ai/api/v2/article/?language=en-US&path=qwen3.5&type=qwen_ai'
export const QWEN_ARTICLE_TITLE = 'Qwen3.5: Towards Native Multimodal Agents'

export function publicAssetUrl(value) {
  const url = new URL(value, QWEN_ARTICLE_URL)
  if (url.protocol !== 'https:' || url.username || url.password
    || !(url.hostname === 'img.alicdn.com' || /^qianwen-res\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname))) {
    throw new Error(`Unsupported official article asset origin: ${url.origin}`)
  }
  return url.href
}

export function articlePayload(payload) {
  const data = payload?.data
  if (payload?.success !== true || data?.path !== 'qwen3.5' || data?.language !== 'en-US'
    || data?.type !== 'qwen_ai' || data?.title !== QWEN_ARTICLE_TITLE || typeof data?.content !== 'string') {
    throw new Error('Public Qwen API did not return the requested English Qwen3.5 article')
  }
  const $ = load(data.content)
  if ($('article.post-single .post-content').length !== 1) throw new Error('Official article HTML structure changed')
  const publishedAt = data.extra?.date
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) throw new Error('Official article publication date is missing')
  // Retain public provenance fields only; the API also returns unrelated internal metadata.
  return { html: data.content, metadata: { title: data.title, publishedAt, language: data.language, author: data.extra?.author || 'Qwen Team' } }
}

function mathml(tex, display) {
  try {
    return katex.renderToString(tex, { output: 'mathml', displayMode: display, trust: false, throwOnError: true, strict: 'ignore', maxExpand: 1_000, maxSize: 10 })
  } catch {
    // Unsupported source TeX remains immutable formula text, with the exact TeX recorded.
    const $ = load('<math><semantics><mtext></mtext><annotation encoding="application/x-tex"></annotation></semantics></math>', {}, false)
    $('math').attr('display', display ? 'block' : 'inline')
    $('mtext,annotation').text(tex)
    return $.html()
  }
}

/** Convert source formula text before translation; code examples are always untouched. */
export function renderSourceMath($, content) {
  let formulas = 0
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$])\$([^$\n]+?)\$(?!\$)/g
  function walk(node) {
    if (node.type === 'text') {
      const text = node.data
      const matches = [...text.matchAll(pattern)]
      if (!matches.length) return
      const fragments = []
      let offset = 0
      for (const match of matches) {
        const before = $('<span>').text(text.slice(offset, match.index)).html()
        fragments.push(before, mathml(match[1] ?? match[2] ?? match[3] ?? match[4], match[1] !== undefined || match[2] !== undefined))
        offset = match.index + match[0].length
        formulas++
      }
      fragments.push($('<span>').text(text.slice(offset)).html())
      $(node).replaceWith(fragments.join(''))
      return
    }
    if (node.type === 'tag' && $(node).is('pre,code,math,script,style')) return
    for (const child of [...(node.children ?? [])]) walk(child)
  }
  walk(content[0])
  return formulas
}

export function prepareArticleHtml(html) {
  const $ = load(html)
  const content = $('article.post-single .post-content').first()
  if (!content.length) throw new Error('Official article content is missing')
  content.find('script,style,noscript,template').remove()
  content.find('a.anchor,a.next-button,button').remove()
  content.find('summary').each((_, node) => $(node).replaceWith($('<p>').text($(node).text())))
  const media = []
  content.find('video').each((index, node) => {
    const src = $(node).attr('src') || $(node).find('source').first().attr('src')
    if (!src) throw new Error('Official video demonstration has no public source URL')
    const url = publicAssetUrl(src)
    const sourceId = $(node).attr('id') || `video-demonstration-${index + 1}`
    const link = $('<p>').attr('id', sourceId).append($('<a>').attr('href', url).text('Watch the official video demonstration'))
    $(node).replaceWith(link)
    media.push({ kind: 'video', url, sourceId })
  })
  // Preserve the official downloadable PDF example as a link, without embedding active content.
  content.find('object,embed,iframe').each((_, node) => {
    const src = $(node).attr('data') || $(node).attr('src')
    if (src) {
      const url = publicAssetUrl(src)
      $(node).replaceWith($('<p>').append($('<a>').attr('href', url).text('Open the official demonstration document')))
    } else $(node).replaceWith($(node).contents())
  })
  content.find('figure').addClass('ltx_figure')
  content.find('table').addClass('ltx_tabular')
  content.find('pre').addClass('ltx_listing')
  content.find('img').each((_, node) => {
    const src = $(node).attr('src')
    if (!src) throw new Error('Official article image has no source URL')
    $(node).attr('src', publicAssetUrl(src))
  })
  const mathCount = renderSourceMath($, content)
  return { $, content, media, mathCount }
}

export function parseQwenArticle(prepared, { html, metadata, fetchedAt = new Date().toISOString(), assets = [] }) {
  const { $, content, media } = prepared
  const sections = [{ id: 'introduction', title: 'Introduction', titleZh: null, level: 1 }]
  const blocks = []
  let currentSection = 'introduction'
  const sectionIds = new Set(['introduction'])
  const add = (nodes, kind, sourceId) => {
    const en = sanitizeHtml(nodes.map(node => $.html(node)).join(''))
    if (!load(en, {}, false).text().trim() && !/<(?:img|math)\b/.test(en)) return
    const id = `block-${String(blocks.length + 1).padStart(3, '0')}`
    blocks.push({ id, sourceId: sourceId || `article-${id}`, sectionId: currentSection, kind, en, zh: null,
      wordCount: load(en, {}, false).text().trim().split(/\s+/).filter(Boolean).length })
  }
  const blockSelector = 'p,figure,table,pre,ul,ol,dl,blockquote,h1,h2,h3,h4,h5,h6,math'
  function children(container) {
    let inline = []
    const flush = () => {
      if (!inline.length) return
      const p = $('<p>').append(inline.map(node => $(node).clone()))
      add([p[0]], 'paragraph')
      inline = []
    }
    for (const node of [...(container.children ?? [])]) {
      if (node.type === 'text') { inline.push(node); continue }
      if (node.type !== 'tag') continue
      const element = $(node)
      if (element.is(blockSelector) || element.find(blockSelector).length || element.is('div,section,details')) {
        flush(); walk(node)
      } else inline.push(node)
    }
    flush()
  }
  function walk(node) {
    const element = $(node)
    if (element.is('h1,h2,h3,h4,h5,h6')) {
      const headingText = element.clone()
      headingText.find('annotation').remove()
      const title = headingText.text().replace(/\s+/g, ' ').trim()
      if (!title) return
      let id = element.attr('id') || `section-${sections.length}`
      if (sectionIds.has(id)) id = `section-${sections.length}`
      sectionIds.add(id); currentSection = id
      element.attr('id', id)
      sections.push({ id, title, titleZh: null, level: Number(node.name.slice(1)) })
      add([node], 'heading', id); return
    }
    const kind = element.is('figure') ? 'figure' : element.is('table') ? 'table' : element.is('pre') ? 'code'
      : element.is('ul,ol,dl') ? 'list' : element.is('math') ? 'equation' : element.is('p,blockquote') ? 'paragraph' : null
    if (kind) { add([node], kind, element.attr('id')); return }
    children(node)
  }
  children(content[0])
  const firstRelease = content.children('p').filter((_, node) => $(node).text().startsWith('We are delighted')).first().text().replace(/\s+/g, ' ').trim()
  return {
    schemaVersion: 1, id: QWEN_ARTICLE_ID, arxivId: null, title: QWEN_ARTICLE_TITLE, titleZh: null,
    authors: ['Qwen Team'], year: new Date(metadata.publishedAt).getUTCFullYear(), tags: mergePaperTags(QWEN_ARTICLE_ID, ['Qwen3.5', '官方文章', '多模态']),
    abstract: firstRelease, abstractZh: null, sections, blocks, assets,
    source: { kind: 'official-article', url: QWEN_ARTICLE_URL, htmlUrl: QWEN_ARTICLE_URL,
      payloadUrl: QWEN_ARTICLE_PAYLOAD_URL, fetchedAt, publishedAt: metadata.publishedAt, language: 'en-US', sha256: sha256(html), media },
    translation: { status: 'pending', model: null, coverage: { complete: 0, total: blocks.length }, humanReviewed: false },
    statistics: { blockCount: blocks.length, sectionCount: sections.length, wordCount: blocks.reduce((total, block) => total + block.wordCount, 0),
      imageCount: content.find('img').length, tableCount: content.find('table').length, codeBlockCount: content.find('pre').length,
      mathCount: content.find('math').length, videoLinkCount: media.length },
  }
}
