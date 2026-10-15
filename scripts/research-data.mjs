import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { load } from 'cheerio'
import { validateResearchCatalog, validateResearchDocument } from '../src/lib/research-schema.mjs'
import { createResearchVisualRuntime } from '../src/lib/research-visuals.mjs'

const visualKinds = new Set(createResearchVisualRuntime().kinds)

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function inspectResearchData(root) {
  root = await realpath(root)
  const files = new Map()
  const safeRead = async relative => {
    const file = await realpath(path.join(root, relative))
    if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file)).isFile()) throw new Error(`Research path escapes data directory: ${relative}`)
    const bytes = await readFile(file)
    if (/^version https:\/\/git-lfs.github.com/.test(bytes.toString('utf8', 0, 150))) throw new Error(`Unhydrated research LFS pointer: ${relative}`)
    files.set(relative, digest(bytes))
    return bytes
  }
  let bytes
  try { bytes = await safeRead('research/catalog.json') } catch (e) { if (e.code === 'ENOENT') return { reports: [], files }; throw e }
  const catalog = validateResearchCatalog(JSON.parse(bytes))
  for (const entry of catalog.reports) {
    const report = validateResearchDocument(JSON.parse(await safeRead(entry.dataPath)), entry)
    const bodyPath = entry.dataPath.replace(/report\.json$/, 'zh.html')
    const body = await safeRead(bodyPath)
    if (body.length !== report.content.bytes || digest(body) !== report.content.sha256) throw new Error(`Research HTML fingerprint mismatch: ${entry.id}`)
    const html = new TextDecoder('utf-8', { fatal: true }).decode(body)
    const $ = load(html)
    const article = $('article[data-research-id]')
    if (article.length !== 1 || article.attr('data-research-id') !== report.id || $('html').attr('lang') !== 'zh-CN') throw new Error(`Research HTML identity mismatch: ${entry.id}`)
    if (article.find('script,style,iframe,object,embed,form,input,button,textarea,select,img,video,audio').length
      || article.find('*').toArray().some(n => Object.keys(n.attribs ?? {}).some(k => /^on/i.test(k)))) throw new Error(`Unsafe research content: ${entry.id}`)
    for (const visual of article.find('[data-research-visual]').toArray()) {
      if (visual.tagName !== 'figure' || !$(visual).attr('id') || !visualKinds.has($(visual).attr('data-research-visual'))
        || $(visual).children('[data-visual-mount]').length !== 1) throw new Error(`Invalid research visual: ${entry.id}`)
    }
    const ids = article.find('[id]').map((_, n) => $(n).attr('id')).get()
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate research anchors: ${entry.id}`)
    const headings = article.find('h2[id]').map((_, n) => $(n).attr('id')).get()
    if (JSON.stringify(headings) !== JSON.stringify(report.sections.map(s => s.id))) throw new Error(`Research sections out of order: ${entry.id}`)
    for (const s of report.sources) {
      if (!ids.includes(`ref-${s.id}`) || !article.find(`a[href="#ref-${s.id}"]`).length) throw new Error(`Missing research citation: ${s.id}`)
      if (!article.find(`[id="ref-${s.id}"] a`).toArray().some(n => $(n).attr('href') === s.url)) throw new Error(`Research source URL differs: ${s.id}`)
    }
    const sourceUrls = new Set(report.sources.map(s => s.url.split('#')[0]))
    article.find('a').each((_, n) => {
      const href = $(n).attr('href') ?? ''
      if (href.startsWith('#') ? !ids.includes(href.slice(1)) : !sourceUrls.has(href.split('#')[0])) throw new Error(`Unregistered research link: ${href}`)
    })
    for (const section of report.sections) if (article.find(`[id="${section.id}"]`).text().trim() !== section.title) throw new Error(`Research section title differs: ${section.id}`)
  }
  return { reports: catalog.reports, files }
}
