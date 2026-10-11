import { load } from 'cheerio'
import katex from 'katex'
import { sanitizeHtml, sha256 } from './paper-lib.mjs'

// Each supported author page has an explicit extraction recipe and identity.
// This is deliberately not an arbitrary-URL HTML scraper.
export const AUTHOR_ARTICLES = Object.freeze({
  'muon-original-design': Object.freeze({
    id: 'muon-original-design', url: 'https://kellerjordan.github.io/posts/muon/',
    title: 'Muon: An optimizer for hidden layers in neural networks',
    author: 'Keller Jordan', publisher: 'Keller Jordan blog',
    publishedAt: '2024-12-08', publishedLabel: 'December 8, 2024',
    contentSelector: 'article.post-single .post-content',
    assetPrefix: '/images/muon/',
  }),
})
export const AUTHOR_ARTICLE_PROCESSOR = 'papero-author-article'
export const AUTHOR_ARTICLE_VERSION = '1.0.0'
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const normalized = value => value.replace(/\s+/g, ' ').trim()
const plain = ($, element) => {
  const clone = element.clone()
  clone.find('annotation,annotation-xml').remove()
  // Equivalent HTML serialization may put whitespace between block elements
  // or omit it. Compare the visible flow, retaining all inline/code text.
  clone.find('p,h1,h2,h3,h4,h5,h6,pre,figure,figcaption,blockquote,li,dt,dd,tr,th,td')
    .each((_, node) => $(node).prepend('\n').append('\n'))
  return normalized(clone.text())
}

export function authorArticleProfile(id) {
  const profile = AUTHOR_ARTICLES[id]
  if (!profile) throw new Error(`Unsupported author article identity: ${id}`)
  return profile
}

export function authorArticleAssetUrl(value, profile) {
  const url = new URL(value, profile.url)
  const origin = new URL(profile.url).origin
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password
    || !url.pathname.startsWith(profile.assetPrefix) || url.search || url.hash
    || !/\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(url.pathname)
    || /[\u0000-\u0020\\]/.test(value)) throw new Error(`Unsupported author article asset URL: ${value}`)
  return url.href
}

export function assertAuthorSourceIdentity(html, profile) {
  const $ = load(html)
  const content = $(profile.contentSelector)
  const citation = content.find('pre code').last().text()
  if (content.length !== 1 || $('link[rel="canonical"]').attr('href') !== profile.url
    || normalized($('h1.post-title').text()) !== profile.title
    || normalized($('.logo a').first().text()) !== profile.publisher
    || !normalized($('.post-meta').first().text()).startsWith(`${profile.publishedLabel} ·`)
    || !citation.includes('author') || !citation.includes(profile.author)
    || !content.text().includes(`me (${profile.author})`)) {
    throw new Error(`Author article source identity, date, or author evidence changed: ${profile.id}`)
  }
  return { $, content }
}

const formulaPattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$])\$([^$\n]+?)\$(?!\$)|\\begin\{(align\*?|equation\*?|gather\*?)\}([\s\S]+?)\\end\{\5\}/g

/** Render source TeX exactly once; code and preexisting MathML stay immutable. */
export function renderAuthorArticleMath($, content) {
  let count = 0
  function visit(node) {
    if (node.type === 'text') {
      const text = node.data, matches = [...text.matchAll(formulaPattern)]
      if (!matches.length) return
      const fragments = []
      let offset = 0
      for (const match of matches) {
        const tex = match[5] ? match[0] : match[1] ?? match[2] ?? match[3] ?? match[4]
        const display = match[1] !== undefined || match[2] !== undefined || match[5] !== undefined
        let rendered
        try {
          rendered = katex.renderToString(tex, { output: 'mathml', displayMode: display, trust: false,
            throwOnError: true, strict: 'ignore', maxExpand: 1_000, maxSize: 10 })
        } catch (error) {
          throw new Error(`Author article source formula cannot be rendered: ${tex}`, { cause: error })
        }
        fragments.push($('<span>').text(text.slice(offset, match.index)).html(), rendered)
        offset = match.index + match[0].length
        count++
      }
      fragments.push($('<span>').text(text.slice(offset)).html())
      $(node).replaceWith(fragments.join(''))
      return
    }
    if (node.type === 'tag' && $(node).is('pre,code,math,script,style')) return
    for (const child of [...(node.children ?? [])]) visit(child)
  }
  visit(content[0])
  return count
}

export function prepareAuthorArticleHtml(html, profile) {
  const { $, content } = assertAuthorSourceIdentity(html, profile)
  const sourceContentSha256 = sha256(content.html())
  content.find('script,style,noscript,template').remove()
  content.find('a.anchor,a.anchorjs-link,button').remove()
  if (content.find('video,object,embed,iframe').length) throw new Error('Author article recipe does not support embedded active media')
  content.find('pre').addClass('ltx_listing')
  content.find('table').addClass('ltx_tabular')
  content.find('figure').addClass('ltx_figure')
  content.find('a').each((_, node) => {
    const href = $(node).attr('href')
    if (!href || href.startsWith('#')) return
    const url = new URL(href, profile.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`Unsupported author article link: ${href}`)
    $(node).attr('href', url.href)
  })
  content.find('img').each((_, node) => {
    const src = $(node).attr('src')
    if (!src) throw new Error('Author article image has no source URL')
    $(node).attr('src', authorArticleAssetUrl(src, profile))
  })
  renderAuthorArticleMath($, content)
  return { $, content, sourceContentSha256 }
}

export function assertAuthorArticleProvenance(paper, { sourceHtml } = {}) {
  const profile = authorArticleProfile(paper?.id)
  const s = paper.source, e = s?.extraction
  if (paper.arxivId !== null || paper.title !== profile.title || paper.year !== 2024
    || JSON.stringify(paper.authors) !== JSON.stringify([profile.author])
    || s?.kind !== 'official-article' || s.url !== profile.url || s.htmlUrl !== profile.url
    || s.author !== profile.author || s.publisher !== profile.publisher
    || s.publishedAt !== profile.publishedAt || s.publishedDatePrecision !== 'day' || s.language !== 'en-US'
    || typeof s.fetchedAt !== 'string' || !Number.isFinite(Date.parse(s.fetchedAt)) || !fingerprint(s.sha256)
    || e?.tool !== AUTHOR_ARTICLE_PROCESSOR || e.version !== AUTHOR_ARTICLE_VERSION
    || !fingerprint(e.processorSha256) || !fingerprint(e.sourceContentSha256) || !fingerprint(e.readingContentSha256)
    || ['headingCount', 'imageCount', 'mathCount', 'codeBlockCount'].some(key => !Number.isSafeInteger(e[key]) || e[key] < 0)
    || e.headingCount < 1 || e.imageCount < 1 || e.mathCount < 1 || e.codeBlockCount < 1
    || !Array.isArray(s.revisionNotes) || s.revisionNotes.some(note => typeof note !== 'string' || !note.trim())) {
    throw new Error(`Invalid author article provenance: ${paper?.id}`)
  }
  if (sourceHtml !== undefined) {
    if (sha256(sourceHtml) !== s.sha256) throw new Error(`Author article source fingerprint mismatch: ${paper.id}`)
    const prepared = prepareAuthorArticleHtml(sourceHtml, profile)
    if (prepared.sourceContentSha256 !== e.sourceContentSha256) throw new Error(`Author article source content fingerprint mismatch: ${paper.id}`)
  }
  return profile
}

export function parseAuthorArticle(prepared, { id, html, fetchedAt, assets, processorSha256 }) {
  const profile = authorArticleProfile(id), { $, content } = prepared
  const sections = [{ id: 'introduction', title: 'Introduction', titleZh: null, level: 1 }]
  const blocks = [], sectionIds = new Set(['introduction'])
  let currentSection = 'introduction'
  const selector = 'p,figure,table,pre,ul,ol,dl,blockquote,h1,h2,h3,h4,h5,h6,math'
  const add = (nodes, kind, sourceId) => {
    const en = sanitizeHtml(nodes.map(node => $.html(node)).join(''))
    const fragment = load(en, {}, false), text = plain(fragment, fragment.root())
    if (!text && !/<(?:img|math)\b/.test(en)) return
    const id = `block-${String(blocks.length + 1).padStart(3, '0')}`
    blocks.push({ id, sourceId: sourceId || `author-${id}`, sectionId: currentSection, kind, en, zh: null,
      wordCount: text.split(/\s+/).filter(Boolean).length })
  }
  function children(container) {
    let inline = []
    const flush = () => {
      if (inline.length) { add([$('<p>').append(inline.map(node => $(node).clone()))[0]], 'paragraph'); inline = [] }
    }
    for (const node of [...(container.children ?? [])]) {
      if (node.type === 'text') { inline.push(node); continue }
      if (node.type !== 'tag') continue
      const element = $(node)
      if (element.is(selector) || element.find(selector).length || element.is('div,section,details')) { flush(); walk(node) }
      else if (!element.is('hr')) inline.push(node)
    }
    flush()
  }
  function walk(node) {
    const element = $(node)
    if (element.is('h1,h2,h3,h4,h5,h6')) {
      const title = plain($, element)
      if (!title) return
      const id = element.attr('id') || `section-${sections.length}`
      if (sectionIds.has(id)) throw new Error(`Duplicate author article section ID: ${id}`)
      sectionIds.add(id); currentSection = id; element.attr('id', id)
      sections.push({ id, title, titleZh: null, level: Number(node.name.slice(1)) })
      add([node], 'heading', id); return
    }
    const kind = element.is('figure') || element.is('p') && element.find('img').length ? 'figure'
      : element.is('table') ? 'table' : element.is('pre') ? 'code'
      : element.is('ul,ol,dl') ? (currentSection === 'references' ? 'reference' : 'list')
      : element.is('math') ? 'equation' : element.is('p,blockquote') ? 'paragraph' : null
    if (kind) { add([node], kind, element.attr('id')); return }
    children(node)
  }
  children(content[0])
  const reading = load(blocks.map(block => block.en).join(''), {}, false)
  const sourceReadingText = plain($, content), readingText = plain(reading, reading.root())
  if (sourceReadingText !== readingText) throw new Error('Author article extraction dropped or duplicated visible content')
  const ids = new Set(reading('[id]').map((_, node) => reading(node).attr('id')).get())
  for (const section of sections) ids.add(section.id)
  for (const href of reading('a[href^="#"]').map((_, node) => reading(node).attr('href').slice(1)).get()) {
    if (!ids.has(decodeURIComponent(href))) throw new Error(`Broken author article internal link: ${href}`)
  }
  const extraction = { tool: AUTHOR_ARTICLE_PROCESSOR, version: AUTHOR_ARTICLE_VERSION, processorSha256,
    sourceContentSha256: prepared.sourceContentSha256, readingContentSha256: sha256(readingText),
    headingCount: content.find('h1,h2,h3,h4,h5,h6').length, imageCount: content.find('img').length,
    mathCount: content.find('math').length, codeBlockCount: content.find('pre').length }
  const paper = {
    schemaVersion: 1, id, arxivId: null, title: profile.title, titleZh: null, authors: [profile.author],
    year: 2024, tags: ['Muon', '优化器', '训练优化', '矩阵优化', '作者文章'],
    abstract: plain($, content.children('p').first()), abstractZh: null, sections, blocks, assets,
    source: { kind: 'official-article', url: profile.url, htmlUrl: profile.url, author: profile.author,
      publisher: profile.publisher, publishedAt: profile.publishedAt, publishedDatePrecision: 'day', fetchedAt,
      language: 'en-US', sha256: sha256(html), extraction,
      revisionNotes: content.children('p').filter((_, node) => /^Note: This subsection was added on /.test($(node).text()))
        .map((_, node) => normalized($(node).text())).get() },
    translation: { status: 'pending', model: null, coverage: { complete: 0, total: blocks.length }, humanReviewed: false },
    statistics: { blockCount: blocks.length, sectionCount: sections.length,
      wordCount: blocks.reduce((sum, block) => sum + block.wordCount, 0), imageCount: extraction.imageCount,
      tableCount: content.find('table').length, codeBlockCount: extraction.codeBlockCount, mathCount: extraction.mathCount },
  }
  assertAuthorArticleProvenance(paper)
  return paper
}
