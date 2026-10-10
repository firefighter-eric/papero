import { load } from 'cheerio'
import { sanitizeHtml, sha256 } from './paper-lib.mjs'

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const css = `:root{color-scheme:light dark}body{margin:0 auto;padding:32px 24px;max-width:960px;font:18px/1.8 system-ui,sans-serif}header{margin-bottom:32px}h1,h2,h3,h4,h5,h6{line-height:1.3}a{color:inherit}img{max-width:100%;height:auto}figure{margin:24px 0}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}th,td{padding:6px 10px;border:1px solid #999}pre{overflow:auto;padding:16px;background:#8881}math[display="block"]{display:block;overflow:auto;margin:16px 0}annotation,annotation-xml{display:none}.ltx_eqn_table{width:100%}.paper-block{margin-bottom:16px}`

export function renderReadingDocument(paper, language, blocks = paper.blocks) {
  let source
  try { source = new URL(paper.source.url) } catch { throw new Error(`Invalid publication source URL: ${paper.id}.`) }
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error(`Invalid publication source URL: ${paper.id}.`)
  const title = language === 'zh' ? paper.titleZh || paper.title : paper.title
  const sourceLabel = paper.source.kind === 'official-article' ? (language === 'zh' ? 'Qwen · 官方文章' : 'Qwen · Official article') : 'arXiv'
  const translationNote = language === 'zh' ? '<p>机器翻译，未经人工审校。</p>' : ''
  const prefix = `<!doctype html>\n<html lang="${language === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body><header><h1>${escape(title)}</h1><p>${escape(paper.authors.join(', '))}</p><p><a href="${escape(paper.source.url)}">${escape(sourceLabel)}</a></p>${translationNote}</header><article data-paper-id="${escape(paper.id)}" data-language="${language}">\n`
  const parts = [prefix], offsets = []
  let byteOffset = Buffer.byteLength(prefix, 'utf8')
  for (const block of blocks) {
    const open = `<div class="paper-block" data-block-id="${escape(block.id)}" data-block-kind="${escape(block.kind)}" data-source-id="${escape(block.sourceId)}" data-section-id="${escape(block.sectionId)}">`
    const body = block[language] ?? ''
    byteOffset += Buffer.byteLength(open, 'utf8')
    const start = byteOffset
    byteOffset += Buffer.byteLength(body, 'utf8')
    offsets.push({ start, end: byteOffset })
    parts.push(open, body, '</div>\n')
    byteOffset += Buffer.byteLength('</div>\n', 'utf8')
  }
  parts.push('</article></body></html>\n')
  return { html: parts.join(''), offsets }
}

export const renderReadingHtml = (paper, language, blocks = paper.blocks) => renderReadingDocument(paper, language, blocks).html

/** Convert internal checkpoint data into metadata plus standalone reading documents. */
export function createPublication(paper) {
  for (const block of paper.blocks) for (const language of ['en', 'zh']) {
    const html = block[language]
    if ((language === 'en' && (typeof html !== 'string' || !html))
      || (html !== null && html !== undefined && (typeof html !== 'string' || sanitizeHtml(html) !== html))) {
      throw new Error(`Unsafe or noncanonical publication block: ${paper.id}/${block.id}/${language}.`)
    }
  }
  const blocks = paper.blocks.map(block => ({ ...block, sourceId: block.sourceId ?? block.id }))
  const documents = { en: renderReadingDocument(paper, 'en', blocks), zh: renderReadingDocument(paper, 'zh', blocks) }
  const html = { en: documents.en.html, zh: documents.zh.html }
  const metadata = { ...paper, blocks: blocks.map(({ en, zh, ...block }, index) => ({ ...block,
    contentSha256: { en: sha256(en), zh: zh === null || zh === undefined ? null : sha256(zh) },
    contentOffsets: { en: documents.en.offsets[index], zh: documents.zh.offsets[index] },
  })), content: { format: 'html', ...Object.fromEntries(['en', 'zh'].map(language => [language, {
    path: `${language}.html`, sha256: sha256(html[language]), bytes: Buffer.byteLength(html[language], 'utf8'),
  }])) } }
  return { metadata, html }
}

/** Verify document markers and reconstruct block HTML only in memory. */
export function parseReadingHtml(html, paper, language) {
  const bytes = Buffer.from(html, 'utf8')
  const $ = load(html)
  const articles = $('body > article')
  if (articles.length !== 1 || $('article').length !== 1 || articles.attr('data-paper-id') !== paper.id
    || articles.attr('data-language') !== language || articles.children().length !== paper.blocks.length
    || articles.contents().toArray().some(node => node.type !== 'text' && node.type !== 'tag')) {
    throw new Error(`Invalid publication document identity or wrapper count: ${paper.id}/${language}.`)
  }
  const blocks = paper.blocks.map((block, index) => {
    if ('en' in block || 'zh' in block) throw new Error(`Published metadata contains body HTML: ${paper.id}/${block.id}.`)
    const wrapper = articles.children().eq(index)
    if (wrapper[0]?.name !== 'div' || wrapper.attr('data-block-id') !== block.id || wrapper.attr('data-block-kind') !== block.kind
      || wrapper.attr('data-source-id') !== block.sourceId || wrapper.attr('data-section-id') !== block.sectionId) {
      throw new Error(`Invalid publication block marker or order: ${paper.id}/${block.id}/${language}.`)
    }
    const range = block.contentOffsets?.[language]
    if (!range || Object.keys(range).length !== 2 || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.end < range.start || range.end > bytes.length) throw new Error(`Invalid publication block byte offsets: ${paper.id}/${block.id}/${language}.`)
    let content
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(range.start, range.end)) }
    catch { throw new Error(`Invalid UTF-8 publication block boundary: ${paper.id}/${block.id}/${language}.`) }
    const expected = block.contentSha256?.[language]
    if ((language === 'zh' && expected === null) ? content !== '' : !fingerprint(expected) || sha256(content) !== expected) {
      throw new Error(`Publication block fingerprint mismatch: ${paper.id}/${block.id}/${language}.`)
    }
    if (sanitizeHtml(content) !== content) throw new Error(`Unsafe or noncanonical publication HTML: ${paper.id}/${block.id}/${language}.`)
    return { ...block, [language]: language === 'zh' && expected === null ? null : content }
  })
  const expectedDocument = renderReadingDocument(paper, language, blocks)
  if (html !== expectedDocument.html) throw new Error(`Unexpected publication document structure: ${paper.id}/${language}.`)
  if (blocks.some((block, index) => block.contentOffsets[language].start !== expectedDocument.offsets[index].start
    || block.contentOffsets[language].end !== expectedDocument.offsets[index].end)) throw new Error(`Publication byte offsets disagree with wrapper boundaries: ${paper.id}/${language}.`)
  return blocks
}
