import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { mergePaperTags } from './paper-tags.mjs'

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')
export const safeId = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
export const validArxivId = (value) => /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/.test(value)

const chatTemplateFields = new Set('think response tools tool index messages tool_choice response_format'.split(' '))
const xtmlBoundary = String.raw`\[(?:open|close|sep|end_of_msg)\]`
const xtmlElement = String.raw`\[(?:open|close)\][A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*="[^"\r\n]*")*\[sep\]`
const xtmlSyntax = new RegExp(`^(?:${xtmlBoundary}|${xtmlElement})(?:\\s+…\\s+(?:${xtmlElement}))*$`)

// Protocol syntax is code even when LaTeXML emits a plain diagram span.
// Only whole literal spans, JSON objects/arrays, and observed typewriter fields qualify;
// ordinary typewriter phrases and prose surrounding a token remain narrative.
export function isLiteralChatTemplateNode(node) {
  if (node.type !== 'tag' || node.name !== 'span' || !node.children?.length || node.children.some(child => child.type !== 'text')) return false
  const text = node.children.map(child => child.data).join('').trim()
  if (xtmlSyntax.test(text)) return true
  if (!(node.attribs?.class || '').split(/\s+/).includes('ltx_font_typewriter')) return false
  if (chatTemplateFields.has(text) || text === 'type="tool-declare"') return true
  if (!/^(?:\{[\s\S]*\}|\[[\s\S]*\])$/.test(text)) return false
  try { const value = JSON.parse(text); return value !== null && typeof value === 'object' } catch { return false }
}

// LaTeXML may leave an entire fenced code block in an ordinary text span.
// Require a complete, standalone fence; quoted prose and partial fences remain narrative.
export function isLiteralFencedCodeNode(node) {
  if (node.type !== 'tag' || node.name !== 'span' || !node.children?.length || node.children.some(child => child.type !== 'text')) return false
  const lines = node.children.map(child => child.data).join('').trim().split(/\r?\n/)
  if (lines.length < 3) return false
  const opening = lines[0].match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/)
  if (opening) {
    if (opening[1][0] === '`' && opening[2].includes('`')) return false
    const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*$`)
    return closing.test(lines.at(-1)) && !lines.slice(1, -1).some(line => closing.test(line))
  }
  // The observed LaTeXML smart-quote fence requires a language and matching end.
  return /^“‘[A-Za-z][A-Za-z0-9_+.#-]*[ \t]*$/.test(lines[0]) && lines.at(-1).trim() === '“‘'
    && lines.slice(1, -1).some(line => line.trim()) && !lines.slice(1, -1).some(line => line.trim() === '“‘')
}

const isLiteralCodeSpanNode = node => isLiteralChatTemplateNode(node) || isLiteralFencedCodeNode(node)

export function scientificSignature($) {
  return $('math,img,a,code,pre,.ltx_listing.ltx_lstlisting,span').map((_, node) => {
    if ($(node).is('math,code,pre,.ltx_listing.ltx_lstlisting') || isLiteralCodeSpanNode(node)) return $.html(node)
    if (node.name === 'img' || node.name === 'a') return `${node.name}:${$(node).attr(node.name === 'img' ? 'src' : 'href')}`
    return null
  }).get()
}

// The importer's fallback abstract section may also contain front matter or
// a figure. Only actual abstract paragraphs contribute to the derived summary.
export function translatedAbstractText(blocks) {
  return blocks.filter(block => block.kind === 'paragraph' && /^abstract[^.]*\./.test(block.sourceId) && block.zh)
    .map(block => {
      const $ = load(block.zh, {}, false)
      $('annotation,annotation-xml').remove()
      return $.root().text().replace(/\s+/g, ' ').trim()
    }).join(' ')
}

// Traverse in document order. Collecting every element's direct contents
// puts a heading's narrative before its nested section number and can invent
// a "Stage N" reference that never occurs in the displayed document.
export function visibleProseText($) {
  const text = []
  const visit = node => {
    if (['math', 'code', 'pre'].includes(node.name) || node.type === 'tag' && ($(node).is('.ltx_listing.ltx_lstlisting') || isLiteralCodeSpanNode(node))) return
    if (node.type === 'text') text.push(node.data)
    else for (const child of node.children ?? []) visit(child)
  }
  visit($.root()[0])
  return text.join(' ')
}

const tags = new Set('p div section h1 h2 h3 h4 h5 h6 br span em strong i b sup sub a cite figure figcaption img table tr th td tbody thead tfoot ul ol li dl dt dd blockquote code pre math semantics annotation mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts mprescripts none mtable mtr mtd maligngroup malignmark'.split(' '))
const attributes = new Set('id class href src alt title width height colspan rowspan display alttext encoding mathvariant stretchy fence separator accent accentunder form lspace rspace columnalign rowalign columnspacing rowspacing columnspan rowspan'.split(' '))
const dangerousTags = 'script style iframe object embed link meta base form input button textarea select noscript template annotation-xml'

export function sanitizeHtml(html) {
  const $ = load(html, { xmlMode: false }, false)
  $(dangerousTags).remove()
  $('*').each((_, element) => {
    const node = $(element)
    if (!tags.has(element.name.toLowerCase())) { node.replaceWith(node.contents()); return }
    for (const key of Object.keys(element.attribs ?? {})) {
      if (!attributes.has(key.toLowerCase())) node.removeAttr(key)
    }
    for (const key of ['href', 'src']) {
      const value = node.attr(key)
      if (!value) continue
      const clean = value.trim()
      const safe = key === 'src'
        ? /^assets\/[a-zA-Z0-9._-]+$/.test(clean)
        : /^#[^\s]*$/.test(clean) || /^https?:\/\//i.test(clean)
      if (!safe) node.removeAttr(key)
    }
    if (element.name === 'a' && /^https?:\/\//.test(node.attr('href') ?? '')) node.attr('rel', 'noopener noreferrer')
  })
  return $.html()
}

export function sanitizeSvg(svg) {
  if (/<!ENTITY/i.test(svg)) throw new Error('SVG entities are not allowed')
  const $ = load(svg, { xmlMode: true }, false)
  if (!$('svg').length) throw new Error('Asset is not an SVG image')
  const allowedTags = new Set('svg g defs style path text tspan title desc lineargradient radialgradient stop clippath mask pattern marker rect circle ellipse line polygon polyline use symbol image'.split(' '))
  function removeDirectives(node) {
    for (const child of [...(node.children ?? [])]) {
      if (child.type === 'directive') $(child).remove()
      else removeDirectives(child)
    }
  }
  removeDirectives($.root()[0])
  $('*').each((_, node) => {
    const element = $(node)
    if (!allowedTags.has(node.name.toLowerCase())) { element.remove(); return }
    for (const [key, value] of Object.entries(node.attribs ?? {})) {
      if (/^on/i.test(key)) element.removeAttr(key)
      if (/^(?:href|xlink:href|src)$/i.test(key) && !/^#[a-zA-Z0-9_.:-]+$/.test(value)) element.removeAttr(key)
      if (/javascript:|expression\s*\(|@import/i.test(value) || /url\(\s*['"]?(?!#)/i.test(value)) element.removeAttr(key)
    }
  })
  $('style').each((_, node) => {
    const css = $(node).text()
    if (/javascript:|expression\s*\(|@import/i.test(css) || /url\(\s*['"]?(?!#)/i.test(css)) $(node).remove()
  })
  return $.xml()
}

export function parsePaper(html, { id, arxivId, htmlUrl, fetchedAt = new Date().toISOString() }) {
  const $ = load(html)
  const article = $('article.ltx_document').first()
  if (!article.length) throw new Error('Source does not contain an arXiv LaTeXML article; no substitute was imported.')
  const title = article.find('h1.ltx_title_document').first().text().trim()
  if (!title) throw new Error('The arXiv article has no title.')
  const authorCredits = article.find('.ltx_personname').map((_, node) => {
    const copy = $(node).clone(); copy.find('.ltx_note').remove(); return copy.text().trim()
  }).get()
  const authors = authorCredits.flatMap(credit => credit.includes(',') && credit.split(',').length > 3
    ? credit.split(',').map(name => name.trim().replace(/^and\s+/i, '')).filter(Boolean)
    : [credit])
  const sections = [{ id: 'frontmatter', title: 'Paper information', titleZh: '论文信息', level: 2 }]
  const blocks = []
  let currentSection = 'frontmatter'
  const add = (node, kind) => {
    const sourceId = $(node).attr('id') || `source-${blocks.length + 1}`
    const en = sanitizeHtml($.html(node))
    blocks.push({ id: `block-${String(blocks.length + 1).padStart(3, '0')}`, sourceId, sectionId: currentSection, kind, en, zh: null })
  }
  const walk = (node) => {
    if (node.type !== 'tag') return
    const element = $(node)
    if (element.is('h1.ltx_title_document')) return
    if (element.is('h2,h3,h4,h5,h6')) {
      const container = element.parent()
      currentSection = container.attr('id') || `section-${sections.length}`
      sections.push({ id: currentSection, title: element.text().replace(/\s+/g, ' ').trim(), titleZh: null, level: Number(node.name.slice(1)) })
      add(node, 'heading'); return
    }
    if (element.is('figure')) { add(node, element.hasClass('ltx_table') ? 'table' : 'figure'); return }
    if (element.is('table')) { add(node, /ltx_equation/.test(element.attr('class') ?? '') ? 'equation' : 'table'); return }
    if (element.is('li.ltx_bibitem')) { add(node, 'reference'); return }
    if (element.is('ul,ol') && !element.hasClass('ltx_biblist')) { add(node, 'list'); return }
    if (element.is('dl')) { add(node, 'list'); return }
    if (element.is('math')) { add(node, 'equation'); return }
    if (element.is('p,.ltx_authors,pre,blockquote,.ltx_listing')) { add(node, 'paragraph'); return }
    element.children().each((_, child) => walk(child))
  }
  article.children().each((_, node) => walk(node))
  const sourceLicense = $('a').filter((_, node) => $(node).text().includes('License:')).first()
  const yearCode = Number((arxivId.includes('/') ? arxivId.split('/')[1] : arxivId).slice(0, 2))
  return {
    schemaVersion: 1, id, arxivId, title, titleZh: null, authors, authorCredits,
    year: yearCode + (yearCode >= 91 ? 1900 : 2000),
    tags: mergePaperTags(id, id === 'attention-is-all-you-need' ? ['Transformer', '注意力机制', '机器翻译'] : /^Qwen/.test(title) ? ['Qwen', /-VL\b/i.test(title) ? '视觉语言模型' : '大语言模型'] : []),
    abstract: article.find('.ltx_abstract p').text().replace(/\s+/g, ' ').trim(), abstractZh: null,
    source: { kind: 'arxiv', url: `https://arxiv.org/abs/${arxivId}`, htmlUrl, fetchedAt, sha256: sha256(html), license: sourceLicense.text().replace('License:', '').trim() || null, licenseUrl: sourceLicense.attr('href') || null },
    translation: { status: 'pending', model: null, coverage: { complete: 0, total: blocks.length }, humanReviewed: false },
    sections, blocks,
    statistics: { blockCount: blocks.length, sectionCount: sections.length, wordCount: article.text().split(/\s+/).length },
  }
}

export function translationUnits(html, kind = 'paragraph') {
  const $ = load(html, {}, false)
  const units = []
  function walk(node) {
    if (node.type === 'text') {
      const text = node.data
      if (/^\s*<\/?think>\s*$/.test(text)) return
      if (/^\s*(?:<\|im_start\|>(?:user|assistant)|<\|im_end\|>)\s*$/.test(text)) return
      if (isIsoBenchmarkLanguageList(text)) return
      if (!/[a-zA-Z]{2}/.test(text) || /^\s*(https?:\S+|[^\s]+@[^\s]+)\s*$/.test(text)) return
      // These reports label contributor names as plain paragraph text rather
      // than .ltx_personname. Preserve only an explicitly labelled name list.
      const parent = $(node.parent)
      if (parent.is('p')) {
        const first = parent.children('span,strong,b').first()
        const label = first.clone(); label.find('.ltx_note').remove()
        const leading = parent.contents().get().find(child => child.type === 'tag' || child.type === 'text' && child.data.trim())
        const names = text.trim().split(/\s*,\s*/)
        if (first.length && leading === first[0] && /^(?:Core\s+)?Contributors\s*:?$/i.test(label.text().replace(/\s+/g, ' ').trim()) && names.length >= 3 && names.every(name => /^(?:and\s+)?(?:[A-Z][A-Za-z'-]*|[A-Z]\.)(?:\s+(?:[A-Z][A-Za-z'-]*|[A-Z]\.))*$/.test(name))) return
      }
      units.push({ id: String(units.length), text, node }); return
    }
    if (node.type !== 'tag' && node.type !== 'root') return
    if (node.type === 'tag') {
      const item = $(node)
      if (item.is('math,code,pre,.ltx_listing.ltx_lstlisting,.ltx_personname,.ltx_note_mark,.ltx_note_type') || isLiteralCodeSpanNode(node)) return
      // Bibliographic author names and venues are original metadata. Translate only the paper title.
      if (kind === 'reference' && item.hasClass('ltx_bibblock') && item.index() !== 2) return
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk($.root()[0])
  return { units, context(blockId) {
    const map = new Map(units.map(unit => [unit.node, unit]))
    const walkContext = (node) => {
      if (node.type === 'text') {
        const unit = map.get(node)
        return unit ? `⟦${blockId}:${unit.id}⟧${unit.text}⟦/${blockId}:${unit.id}⟧` : node.data
      }
      if (node.type === 'tag' && node.name === 'math') return `⟪FORMULA:${$(node).attr('alttext') || $(node).find('annotation').text() || $(node).text()}⟫`
      if (node.type === 'tag' && ($(node).is('code,pre,.ltx_listing.ltx_lstlisting') || isLiteralCodeSpanNode(node))) return '⟪CODE_PRESERVED⟫'
      return (node.children ?? []).map(walkContext).join('')
    }
    return walkContext($.root()[0]).replace(/\n{3,}/g, '\n\n')
  }, render(translations) {
    if (!Array.isArray(translations) || translations.length !== units.length) throw new Error('Translation unit count mismatch')
    units.forEach((unit, index) => {
      const translated = translations[index]
      if (typeof translated !== 'string' || !translated.trim()) throw new Error(`Empty translation for unit ${index}`)
      unit.node.data = translated
    })
    return sanitizeHtml($.html())
  } }
}

const legacyModelPattern = /\b(?:Qwen\d+(?:\.\d+)*(?:[-_][A-Za-z0-9.]+)*|(?:GPT|LLaMA|Llama|Gemini|Claude|DeepSeek|Mixtral|Mistral)(?:[-_]?[0-9]+(?:\.[0-9]+)*(?:[-_][A-Za-z0-9.]+)*)|(?:BF|FP|INT)\d+|GSM8K|MMLU(?:-Pro)?|GPQA(?:-Diamond)?|IFEval|HumanEval|MBPP|MMMU|MathVista|DocVQA|ChartQA|VideoMME|LiveCodeBench|Android Control)\b/gi
// These reports use both branded and short model names. Keep version letters,
// decimal versions and full checkpoint suffixes together; an embedded V3 or K2
// numeral is otherwise invisible to the ordinary numeric-token guard.
const reportModelFamilies = String.raw`(?:DeepSeek[-_ ]?[VR]\d+(?:\.\d+)*(?:[-_][A-Za-z0-9.]+)*|Kimi[-_ ]?K\d+(?:\.\d+)*(?:[-_][A-Za-z0-9.]+)*|MiniMax[-_ ]?M\d+(?:\.\d+)*(?:[-_][A-Za-z0-9.]+)*|K(?:1\.5|2(?:\.[56])?|3)(?:[-_][A-Za-z0-9.]+)*(?!\.\d))`
const modelPattern = new RegExp(String.raw`\b${reportModelFamilies}\b|${legacyModelPattern.source}`, 'gi')

// Prose en/em dashes separate words; true identifier hyphens remain hyphens.
const identifierText = (text) => text.normalize('NFKC').replace(/[\u2013\u2014\u2015]/g, ' ').replace(/[\u2010\u2011]/g, '-')
export const technicalIdentifiers = (text) => (identifierText(text).match(modelPattern) || []).map(value => value.replace(/-(?:level|scale|sized|based|like)$/i, ''))

const benchmarkLanguageCodes = new Set('af ar az be bg bn ca cs cy da de el en es et eu fa fi fr gu he hi hr hu hy id it ja ka kk kn ko lt lv mk ml mr ms ne nl no pa pl pt ro ru sk sl so sq sr sv sw ta te th tl tr uk ur uz vi zh zh-Hans zh-Hant'.split(' '))
// Exact language/script labels observed in the report's Table 36. This is a
// finite source-label allowlist, not a general exemption for underscore prose.
const isoBenchmarkLanguageCodes = new Set('acm_Arab afr_Latn als_Latn apc_Arab arb_Arab ars_Arab ary_Arab asm_Beng azj_Latn ben_Beng bul_Cyrl cat_Latn ceb_Latn ces_Latn dan_Latn deu_Latn ell_Grek eng_Latn erz_Arab est_Latn eus_Latn fin_Latn fra_Latn guj_Gujr hat_Latn heb_Hebr hin_Deva hrv_Latn hun_Latn hye_Armn ilo_Latn ind_Latn isl_Latn ita_Latn jav_Latn jpn_Jpan kan_Knda kat_Geor kaz_Cyrl kea_Latn kor_Hang lit_Latn mal_Mlym mar_Deva mkd_Cyrl mlt_Latn mya_Mymr nld_Latn nob_Latn npi_Deva ory_Orya pan_Guru pol_Latn por_Latn ron_Latn rus_Cyrl sin_Sinh slk_Latn slv_Latn snd_Arab spa_Latn srp_Cyrl sun_Latn swe_Latn swh_Latn tam_Taml tel_Telu tgk_Cyrl tgl_Latn tur_Latn ukr_Cyrl urd_Arab uzn_Latn war_Latn zho_Hans zho_Hant'.split(' '))
function isIsoBenchmarkLanguageList(text) {
  const codes = text.trim().replace(/,$/, '').split(/\s*,\s*/)
  return codes.length >= 3 && codes.every(code => /^[a-z]{3}_[A-Z][a-z]{3}$/.test(code) && isoBenchmarkLanguageCodes.has(code))
}
function isBenchmarkLanguageList(text) {
  const codes = text.trim().replace(/,$/, '').split(/\s*,\s*/)
  return codes.length >= 3 && codes.every(code => benchmarkLanguageCodes.has(code))
}

export function isTechnicalLabelOnly(text) {
  if (isBenchmarkLanguageList(text) || isIsoBenchmarkLanguageList(text)) return true
  const residual = identifierText(text).replace(/(?<![A-Za-z0-9_])(?:C\+\+|C#|Python|JAVA|PHP|TypeScript|Bash|JavaScript|CoT|\d+-shot|MBPP-\d+shot)(?![A-Za-z0-9_])/gi, '').replace(modelPattern, '')
  return /[A-Za-z]/.test(text) && !/[A-Za-z\u3400-\u9fff]/.test(residual)
}

function calendarDates(text) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const monthPattern = names.map(name => `${name}|${name.slice(0, 3)}\\.?`).join('|')
  const dates = []
  const replace = (whole, year, month, day) => {
    const y = Number(year), m = Number(month), d = day === undefined ? null : Number(day)
    const date = new Date(Date.UTC(y, m - 1, d ?? 1))
    if (m < 1 || m > 12 || (d !== null && (d < 1 || date.getUTCDate() !== d || date.getUTCMonth() !== m - 1))) return whole
    dates.push(`${y}-${m}${d === null ? '' : `-${d}`}`)
    return ' '
  }
  const monthNumber = name => names.findIndex(value => value.slice(0, 3).toLowerCase() === name.slice(0, 3).toLowerCase()) + 1
  const bibliographyDate = (whole, year, month, suffix) => {
    const value = replace(whole, year, month)
    if (value === ' ') dates[dates.length - 1] += suffix
    return value
  }
  let clean = text
    .replace(new RegExp(`\\b(${monthPattern})\\s+((?:19|20)\\d{2})([a-z])\\b`, 'g'), (whole, month, year, suffix) => bibliographyDate(whole, year, monthNumber(month), suffix))
    .replace(/\b((?:19|20)\d{2})([a-z])\s*年\s*(\d{1,2})\s*月(?!\s*\d)/g, (whole, year, suffix, month) => bibliographyDate(whole, year, month, suffix))
    .replace(/\b((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月([a-z])\b/g, (whole, year, month, suffix) => bibliographyDate(whole, year, month, suffix))
    .replace(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+((?:19|20)\\d{2})\\b`, 'gi'), (whole, month, day, year) => replace(whole, year, monthNumber(month), day))
    .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})[,]?\\s+((?:19|20)\\d{2})\\b`, 'gi'), (whole, day, month, year) => replace(whole, year, monthNumber(month), day))
    .replace(/\b((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g, replace)
    .replace(/\b((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g, replace)
  clean = clean
    .replace(new RegExp(`\\b(${monthPattern})\\s+((?:19|20)\\d{2})\\b`, 'gi'), (whole, month, year) => replace(whole, year, monthNumber(month)))
    .replace(/\b((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月(?!\s*\d)/g, (whole, year, month) => replace(whole, year, month))
  // Month/day dates have no implied year. Keep them in a separate canonical
  // namespace, and handle full dates first so a year can never be discarded.
  const yearlessDate = (whole, month, day) => {
    const m = Number(month), d = Number(day)
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    if (!maxDay || d < 1 || d > maxDay) throw new Error(`Invalid calendar date: ${whole}`)
    dates.push(`--${m}-${d}`)
    return ' '
  }
  clean = clean
    .replace(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\w|\\.\\d)(?!\\s*,?\\s*(?:19|20)\\d{2}\\b)`, 'gi'), (whole, month, day) => yearlessDate(whole, monthNumber(month), day))
    .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?!\\w|\\.\\d)(?!\\s*,?\\s*(?:19|20)\\d{2}\\b)`, 'gi'), (whole, day, month) => yearlessDate(whole, monthNumber(month), day))
    .replace(/(?<![\w.])(?<!\d\s*[A-Za-z]?\s*年\s*)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号](?!\d)/g, (whole, month, day) => yearlessDate(whole, month, day))
  return { clean, dates }
}

export function assertTranslationFidelity(source, translated) {
  const normalize = (text) => text.normalize('NFKC').replace(/\u00a0/g, ' ')
  const normalizeNumbers = (text) => text.normalize('NFKC').replace(/[\u2010\u2011]/g, '-')
    .replace(new RegExp(`(?:${modelPattern.source})[\\u2013\\u2014\\u2015]`, 'gi'), ' ').replace(modelPattern, '')
    // An en/em dash between two explicit multipliers is a positive range;
    // a mathematical minus sign (U+2212) still denotes a negative endpoint.
    .replace(/(\d+(?:\.\d+)?\s*[×x])\s*[\u2013\u2014]\s*(?=\d+(?:\.\d+)?\s*[×x])/g, '$1 to ')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00a0/g, ' ')
  const en = normalize(source), zh = normalize(translated)
  const contextMarkers = /⟪FORMULA:[^⟫]*⟫|⟪CODE_PRESERVED⟫|⟦\/?[A-Za-z0-9_.-]+:\d+⟧/gi
  const remainingContextMarkers = [...(zh.match(contextMarkers) || [])]
  for (const marker of en.match(contextMarkers) || []) {
    const index = remainingContextMarkers.indexOf(marker)
    if (index < 0) throw new Error(`Literal source context marker omitted or changed: ${marker}`)
    remainingContextMarkers.splice(index, 1)
  }
  if (remainingContextMarkers.length) throw new Error(`Generated context marker leaked into translation: ${remainingContextMarkers.join(', ')}`)
  if (isBenchmarkLanguageList(en) || isIsoBenchmarkLanguageList(en)) {
    const labels = text => text.trim().replace(/,$/, '').replace(/\s/g, '')
    if (labels(en) !== labels(zh)) throw new Error('Benchmark language tags changed')
  }
  for (const delimiter of ['<think>', '</think>', '<|im_start|>', '<|im_end|>']) if (en.split(delimiter).length !== zh.split(delimiter).length) throw new Error(`Literal source delimiter changed: ${delimiter}`)
  const protocolRoles = zh.match(/<\|im_start\|>(?:user|assistant)\b/g) || []
  for (const role of en.match(/<\|im_start\|>(?:user|assistant)\b/g) || []) {
    const index = protocolRoles.indexOf(role)
    if (index < 0) throw new Error(`Literal protocol role changed: ${role}`)
    protocolRoles.splice(index, 1)
  }
  if (protocolRoles.length) throw new Error('Literal protocol roles added to translation')
  if (/\badvantages?\b/i.test(en) && /\bmodels?\b/i.test(en) && (!/优势|优点|益处|长处/.test(zh) || !/模型/.test(zh))) throw new Error('Core concepts omitted: advantages/models')
  const sourceHumanAnnotations = (en.match(/\b(?:human annotation|manual annotation|manually annotated)\b/gi) || []).length
  if (/\bartificially annotated\b/i.test(en) && (zh.match(/人工标注/g) || []).length > sourceHumanAnnotations) throw new Error('Automated annotation incorrectly translated as human annotation')
  if (/\bare (?:reported|shown|presented|listed|provided) in Section\s*$/i.test(en) && !/章节|小节|节中|节内/.test(zh)) throw new Error('Section reporting concept omitted from fragment')
  if (/\btrained?\s+(?:a\s+)?Vision Transformer(?:\s*\(ViT\))?\s+from scratch\b/i.test(en) && (!/从零|从头|零开始/.test(zh) || !/训练/.test(zh) || !/ViT|Transformer|视觉变换器/i.test(zh))) throw new Error('From-scratch Vision Transformer training omitted')
  if (/\bfully described in\s*$/i.test(en) && (!/描述|介绍|说明|详述|详见/.test(zh) || !/详细|完整|全面|充分|详/.test(zh))) throw new Error('Complete description predicate omitted from fragment')
  if (/\bin Section\s*$/i.test(en) && !/(?:章节|小节|(?:详?见|位于|在)?第)\s*$/.test(zh)) throw new Error('Section pointer misplaced before immutable number')
  if (/\btens of trillions\b/i.test(en) && !/(?:数十|几十)\s*(?:万亿|T\b)|tens of trillions/i.test(zh)) throw new Error('Tens-of-trillions quantity multiplier omitted')
  if (/\bAndroid Control\b/.test(en) && !/\bAndroid Control\b/.test(zh)) throw new Error('Technical identifier omitted or changed: Android Control')
  const sourceIdentifiers = technicalIdentifiers(en)
  const targetIdentifiers = technicalIdentifiers(zh)
  const identifiers = targetIdentifiers.map(value => value.toLowerCase())
  for (const identifier of sourceIdentifiers) {
    const index = identifiers.indexOf(identifier.toLowerCase())
    if (index < 0) throw new Error(`Technical identifier omitted or changed: ${identifier}`)
    identifiers.splice(index, 1)
  }
  if (identifiers.length) throw new Error(`Technical identifiers added to translation: ${identifiers.join(', ')}`)
  const sourceCalendar = calendarDates(en), targetCalendar = calendarDates(zh)
  const remainingDates = [...targetCalendar.dates]
  for (const date of sourceCalendar.dates) {
    const index = remainingDates.indexOf(date)
    if (index < 0) throw new Error(`Calendar date omitted or changed: ${date}`)
    remainingDates.splice(index, 1)
  }
  if (remainingDates.length) throw new Error(`Calendar dates added to translation: ${remainingDates.join(', ')}`)
  const unitScale = { billion: 1e9, million: 1e6, trillion: 1e12, B: 1e9, M: 1e6, T: 1e12, K: 1e3, k: 1e3, 千: 1e3, 万: 1e4, 百万: 1e6, 十亿: 1e9, 亿: 1e8, 万亿: 1e12 }
  const quantityNumber = '[+-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?'
  const quantityUnit = '(?:[Bb]illion|[Mm]illion|[Tt]rillion|百万|十亿|万亿|亿|万|千|[BMTKk]\\b)'
  const canonicalQuantity = (value, unit) => String(Number((Number(value.replace(/,/g, '')) * (unitScale[unit] || unitScale[unit.toLowerCase()])).toPrecision(15)))
  // Report compound modifiers bind a number to its scale: "1-million-token"
  // and "2.8-trillion-parameter". Match complete standalone compounds before
  // dash normalization so identifier/range hyphens and mathematical minus
  // connectors cannot be reinterpreted as quantity separators.
  const compoundQuantity = new RegExp(`(?<![\\w.+\\-\\u2010-\\u2015\\u2212])(${quantityNumber})-([Bb]illion|[Mm]illion|[Tt]rillion)-(?=(?:tokens?|parameters?)\\b)`, 'g')
  const numbers = (text) => {
    let normalized = normalizeNumbers(text.normalize('NFKC').replace(compoundQuantity, (_, value, unit) => `${canonicalQuantity(value, unit)} `))
    // Bibliography suffixes such as "Wang et al., 2024k" denote a year,
    // whereas "32k tokens" is a quantity. Never multiply a citation year.
    normalized = normalized.replace(/\b((?:19|20)\d{2})k\b/g, '$1_citation')
    // A trailing unit applies to both ends of a quantity range (0.5 to 72 billion).
    normalized = normalized.replace(new RegExp(`(?<![\\w.])(${quantityNumber})\\s*(?:to|到|至|-)\\s*(${quantityNumber})\\s*(${quantityUnit})`, 'g'), (_, first, last, unit) => `${canonicalQuantity(first, unit)} to ${canonicalQuantity(last, unit)}`)
    normalized = normalized.replace(new RegExp(`(?<![\\w.])(${quantityNumber})\\s*(${quantityUnit})`, 'g'), (_, value, unit) => canonicalQuantity(value, unit))
    return normalized.match(/(?<![\w.])[+-]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][+-]?\d+)?\s*%?/g)?.map(value => value.replace(/[,\s]/g, '')) || []
  }
  let sourceNumericText = sourceCalendar.clean, targetNumericText = targetCalendar.clean
  // "3rd-party" is the lexical third-party relationship, not a count of
  // three. Match its own occurrences before checking the remaining numbers;
  // an unrelated score or a different ordinal cannot stand in for it.
  if (/(?<![\w.-])3rd[- ]party(?![\w.-])/i.test(sourceNumericText)) {
    const sourceParties = /(?<![\w.-])(?:3rd|third)[- ]party(?![\w.-])/gi
    const targetParties = /(?<![\w.-])(?:3rd|third)[- ]party(?![\w.-])|第三方/gi
    const expected = (sourceNumericText.match(sourceParties) || []).length
    if ((targetNumericText.match(targetParties) || []).length !== expected) throw new Error('Third-party relationship omitted, added or changed')
    sourceNumericText = sourceNumericText.replace(sourceParties, ' ')
    targetNumericText = targetNumericText.replace(targetParties, ' ')
  }
  const extraPerRow = (sourceNumericText.match(/\b1 extra per row\b/g) || []).length
  if (extraPerRow) {
    const translatedExtras = (targetNumericText.match(/每行\s*(?:多出|多)(?:了)?\s*一列/g) || []).length
    if (translatedExtras > extraPerRow) throw new Error('One-extra-per-row quantity added to translation')
    targetNumericText = targetNumericText.replace(/每行\s*(?:多出|多)(?:了)?\s*一列/g, '每行多 1 列')
  }
  const stagePattern = /\bStage\s+(\d+)\b/gi
  const stages = [...sourceNumericText.matchAll(stagePattern)].map(match => String(Number(match[1])))
  if (stages.length) {
    const digit = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    const ordinal = label => {
      if (/^\d+$/.test(label)) return String(Number(label))
      if (Object.hasOwn(digit, label)) return String(digit[label])
      const tens = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(label)
      return tens ? String((tens[1] ? digit[tens[1]] : 1) * 10 + (tens[2] ? digit[tens[2]] : 0)) : null
    }
    // Only an explicit source Stage N permits a Chinese stage ordinal. Stage
    // references keep their own multiset so a score cannot disguise a changed
    // stage, and an ordinal cannot license an unrelated missing/invented number.
    const targetStages = /\bStage\s+(\d+)\b|第\s*([零〇一二三四五六七八九十\d]+)\s*阶段|阶段\s*(\d+)(?!\d)/gi
    const remaining = [...stages]
    targetNumericText = targetNumericText.replace(targetStages, (match, english, chinese, arabic) => {
      const value = ordinal(english ?? chinese ?? arabic), index = remaining.indexOf(value)
      if (index < 0) throw new Error(`Stage reference added or changed: ${match}`)
      remaining.splice(index, 1)
      return ' '
    })
    if (remaining.length) throw new Error(`Stage reference omitted or changed: ${remaining.join(', ')}`)
    sourceNumericText = sourceNumericText.replace(stagePattern, ' ')
  }
  const originalNumbers = numbers(sourceNumericText), translatedNumbers = numbers(targetNumericText)
  for (const number of originalNumbers) {
    const index = translatedNumbers.indexOf(number)
    if (index < 0) throw new Error(`Numeric value omitted or changed: ${number}`)
    translatedNumbers.splice(index, 1)
  }
  // Permit only the actual cardinal values present in the source, once each.
  // The presence of "eight" must never license an unrelated invented score.
  const cardinalValues = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
  const cardinalPattern = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?(?:\s+(?:hundred|thousand|million|billion|trillion))?\b/gi
  const lexicalNumbers = [...en.matchAll(cardinalPattern)].map(match => {
    const words = match[0].toLowerCase().split(/[- ]+/)
    let value = 0
    for (const word of words) value = cardinalValues[word] === undefined ? (value || 1) * ({ hundred: 100, thousand: 1000, million: 1e6, billion: 1e9, trillion: 1e12 }[word] || 1) : value + cardinalValues[word]
    return String(value)
  })
  for (const number of translatedNumbers) {
    const index = lexicalNumbers.indexOf(number)
    if (index < 0) throw new Error(`Numeric values added to translation: ${number}`)
    lexicalNumbers.splice(index, 1)
  }
}

// The section number already exists as immutable source markup. A model may repeat
// that number at the start of its title text; remove only this exact duplicate.
export function normalizeHeadingNumber(en, zh) {
  const source = load(en, {}, false)
  const number = source('.ltx_tag').first().text().trim().replace(/\.$/, '')
  if (!/^\d+(?:\.\d+)*$/.test(number)) return zh
  const prefix = new RegExp(`^\\s*${number.replace(/\./g, '\\.')}(?=\\s|[、:：]|\\.(?!\\d)|[\\u3400-\\u9fff]|$)[\\s、:：.]*`)
  const narrativeNodes = ($) => {
    const nodes = []
    const walk = (node) => {
      if (node.type === 'text') { if (node.data.trim()) nodes.push(node); return }
      if (node.type === 'tag' && ($(node).hasClass('ltx_tag') || node.name === 'math')) return
      for (const child of node.children ?? []) walk(child)
    }
    walk($.root()[0])
    return nodes
  }
  const originalNarrative = narrativeNodes(source)[0]
  // A title can legitimately begin with the same number (for example "7 reasons").
  if (!originalNarrative || prefix.test(originalNarrative.data)) return zh
  const translated = load(zh, {}, false)
  if (translated('.ltx_tag').first().text().trim().replace(/\.$/, '') !== number) return zh
  const translatedNarrative = narrativeNodes(translated)[0]
  if (!translatedNarrative || !prefix.test(translatedNarrative.data)) return zh
  translatedNarrative.data = translatedNarrative.data.replace(prefix, '')
  return sanitizeHtml(translated.html())
}

export function catalogEntry(paper) {
  return {
    id: paper.id, arxivId: paper.arxivId, sourceKind: paper.source.kind || 'arxiv', title: paper.title, titleZh: paper.titleZh,
    authors: paper.authors, year: paper.year, tags: paper.tags, abstract: paper.abstract, abstractZh: paper.abstractZh,
    sourceUrl: paper.source.url, sourceHtmlUrl: paper.source.htmlUrl,
    translationStatus: paper.translation.status,
    blockCount: paper.blocks.length, sectionCount: paper.sections.length,
    dataPath: `papers/${paper.id}/paper.json`,
  }
}
