import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { load } from 'cheerio'
import { describe, expect, it, vi } from 'vitest'
import { articlePayload, prepareArticleHtml, parseQwenArticle, QWEN_ARTICLE_PAYLOAD_URL, QWEN_ARTICLE_TITLE, publicAssetUrl } from '../scripts/qwen-blog-lib.mjs'
import { importQwenBlog, publishStagedArticle } from '../scripts/import-qwen-blog.mjs'
import { sha256, sanitizeHtml, translationUnits } from '../scripts/paper-lib.mjs'
import { verifyData } from '../scripts/verify-data.mjs'
import { withExclusivePaperLock } from '../scripts/catalog-lock.mjs'
import { sanitizePaperHtml, validateCatalog, validatePaper } from '../src/lib/paper-data'

const assetUrl = 'https://qianwen-res.oss-accelerate.aliyuncs.com/Qwen3.5/diagram.png'
const html = `<html><body><article class="post-single"><div class="post-content">
<figure><img src="${assetUrl}" alt="Architecture"></figure>
<p>We are delighted to release Qwen3.5.</p>
<h2 id="performance">Performance $AC$<a class="anchor" href="#performance">#</a></h2>
<div><table><thead><tr><th>Model</th><th>Score</th></tr></thead><tbody><tr><td>Qwen3.5</td><td>87.8</td></tr></tbody></table></div>
<div class="demo"><div class="title"><span>Example</span><a class="next-button">Next</a></div>
<div class="content">Unwrapped narrative <strong>must survive</strong>.<img src="${assetUrl}"><p>Math: $y^2 = 2px$.</p>
<details><summary>Tool call</summary><pre><code>print('$source_code')\nif x &lt; 2: pass</code></pre></details>
<p>Unsupported: $\\unknowncommand{original}$.</p>
<video src="https://qianwen-res.oss-accelerate.aliyuncs.com/example.mp4"></video>
<object data="https://qianwen-res.oss-accelerate.aliyuncs.com/example.pdf"><a href="https://qianwen-res.oss-accelerate.aliyuncs.com/example.pdf">Download</a></object></div></div>
<script>alert('do not ingest')</script></div></article></body></html>`
const payload = { success: true, data: { path: 'qwen3.5', language: 'en-US', type: 'qwen_ai', title: QWEN_ARTICLE_TITLE, content: html,
  extra: { date: '2026-02-16T04:00:00+08:00', author: 'Qwen Team', git_url: 'internal metadata is not retained' } } }

describe('official Qwen article ingestion', () => {
  it('requires exact source identity and retains only public provenance', () => {
    const source = articlePayload(payload)
    expect(source.metadata.publishedAt).toBe('2026-02-16T04:00:00+08:00')
    expect(source.metadata).not.toHaveProperty('git_url')
    expect(() => articlePayload({ ...payload, data: { ...payload.data, path: 'qwen3.5-omni' } })).toThrow(/requested English/)
    expect(() => publicAssetUrl('https://evil.example/image.png')).toThrow(/origin/)
    expect(() => publicAssetUrl('javascript:alert(1)')).toThrow()
  })

  it('preserves narrative, tables, code, source formulas and video links while removing active UI', () => {
    const source = articlePayload(payload)
    const prepared = prepareArticleHtml(source.html)
    prepared.content.find('img').attr('src', 'assets/diagram.png')
    const paper = parseQwenArticle(prepared, source)
    const output = paper.blocks.map(block => block.en).join('')
    const $ = load(output, {}, false)
    expect(paper.arxivId).toBeNull()
    expect(paper.source.kind).toBe('official-article')
    expect(validatePaper(paper).id).toBe('qwen3-5-official-article')
    expect($.text()).toContain('Unwrapped narrative must survive')
    expect($('table')).toHaveLength(1)
    expect($('img')).toHaveLength(2)
    expect($('pre').text()).toBe("print('$source_code')\nif x < 2: pass")
    expect($('math')).toHaveLength(3)
    expect(paper.sections[1].title).toBe('Performance AC')
    expect($('annotation').map((_, node) => $(node).text()).get()).toEqual(['AC', 'y^2 = 2px', '\\unknowncommand{original}'])
    expect($('script,video,object,iframe,style')).toHaveLength(0)
    expect(paper.source.media).toHaveLength(1)
    expect($(`a[href="${paper.source.media[0].url}"]`)).toHaveLength(1)
    expect($.text()).not.toContain('Next')
    expect(paper.blocks.every(block => sanitizeHtml(block.en) === block.en)).toBe(true)
    const browserHtml = load(sanitizePaperHtml(output, `papers/${paper.id}/paper.json`, 'https://papers.example/data'), {}, false)
    expect(browserHtml('math')).toHaveLength(3)
    expect(browserHtml('table')).toHaveLength(1)
    expect(browserHtml('pre').text()).toBe($('pre').text())
    expect(browserHtml('img').first().attr('src')).toBe(`https://papers.example/data/papers/${paper.id}/assets/diagram.png`)
    const formulaBlock = paper.blocks.find(block => block.en.includes('y^2'))
    expect(translationUnits(formulaBlock.en).units.map(unit => unit.text).join('')).not.toContain('y^2')
  })

  it('stages by default, deduplicates assets, registers explicitly and preserves translated content on repetition', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'papero-qwen-article-'))
    try {
      const stageDir = path.join(temp, 'staging')
      const dataDir = path.join(temp, 'data')
      const fetcher = vi.fn(async url => url === QWEN_ARTICLE_PAYLOAD_URL
        ? new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
        : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
      const paper = await importQwenBlog({ stageDir, dataDir, fetcher })
      expect(await readdir(temp)).toEqual(['staging'])
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(await readFile(path.join(stageDir, 'source.html'), 'utf8')).toBe(html)
      expect(paper.source.sha256).toBe(sha256(html))
      await publishStagedArticle(stageDir, dataDir)
      const catalog = validateCatalog(JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8')))
      expect(validatePaper(paper, catalog.papers[0]).source.kind).toBe('official-article')
      await verifyData({ dataDir, requireData: true })
      const firstBlock = paper.blocks[0]
      firstBlock.zh = firstBlock.en
      paper.translation.coverage.complete = 1
      const registeredFile = path.join(dataDir, 'papers', paper.id, 'paper.json')
      await writeFile(registeredFile, JSON.stringify(paper))
      await importQwenBlog({ stageDir, dataDir, fetcher })
      await publishStagedArticle(stageDir, dataDir)
      expect(JSON.parse(await readFile(registeredFile, 'utf8')).blocks[0].zh).toBe(firstBlock.en)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally { await rm(temp, { recursive: true, force: true }) }
  })

  it('rejects damaged staging before creating or changing a local catalog', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'papero-qwen-stage-integrity-'))
    try {
      const stageDir = path.join(temp, 'staging')
      const dataDir = path.join(temp, 'data')
      const fetcher = vi.fn(async url => url === QWEN_ARTICLE_PAYLOAD_URL
        ? new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
        : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
      const paper = await importQwenBlog({ stageDir, dataDir, fetcher })
      await writeFile(path.join(stageDir, 'source.html'), 'damaged')
      await expect(publishStagedArticle(stageDir, dataDir)).rejects.toThrow(/source fingerprint/)
      await writeFile(path.join(stageDir, 'source.html'), html)
      await writeFile(path.join(stageDir, 'assets', paper.assets[0].filename), 'damaged')
      await expect(publishStagedArticle(stageDir, dataDir)).rejects.toThrow(/asset fingerprint/)
      expect(await readdir(temp)).toEqual(['staging'])
    } finally { await rm(temp, { recursive: true, force: true }) }
  })

  it('rejects same-source extraction changes before overwriting registered files or catalog', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'papero-qwen-stage-extraction-'))
    try {
      const stageDir = path.join(temp, 'staging')
      const dataDir = path.join(temp, 'data')
      const fetcher = vi.fn(async url => url === QWEN_ARTICLE_PAYLOAD_URL
        ? new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
        : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
      const paper = await importQwenBlog({ stageDir, dataDir, fetcher })
      await publishStagedArticle(stageDir, dataDir)
      const registeredFile = path.join(dataDir, 'papers', paper.id, 'paper.json')
      const catalogFile = path.join(dataDir, 'catalog.json')
      const registeredBefore = await readFile(registeredFile, 'utf8')
      const catalogBefore = await readFile(catalogFile, 'utf8')
      const originalStage = JSON.stringify(paper)
      paper.blocks.push({ ...paper.blocks[0], id: 'new-parser-code', kind: 'code', en: '<pre><code>print(1)</code></pre>' })
      await writeFile(path.join(stageDir, 'paper.json'), JSON.stringify(paper))
      await expect(publishStagedArticle(stageDir, dataDir)).rejects.toThrow(/extraction changed/)
      expect(await readFile(registeredFile, 'utf8')).toBe(registeredBefore)
      expect(await readFile(catalogFile, 'utf8')).toBe(catalogBefore)
      const changedSections = JSON.parse(originalStage)
      changedSections.sections[1].title = 'Changed source heading'
      await writeFile(path.join(stageDir, 'paper.json'), JSON.stringify(changedSections))
      await expect(publishStagedArticle(stageDir, dataDir)).rejects.toThrow(/extraction changed/)
      expect(await readFile(registeredFile, 'utf8')).toBe(registeredBefore)
      expect(await readFile(catalogFile, 'utf8')).toBe(catalogBefore)
    } finally { await rm(temp, { recursive: true, force: true }) }
  })

  it('refuses article registration while another owner holds the paper, preserving source and catalog', async () => {
    const temp = await mkdtemp(path.join(tmpdir(), 'papero-qwen-active-owner-'))
    let release
    let held
    try {
      const stageDir = path.join(temp, 'staging')
      const dataDir = path.join(temp, 'data')
      const fetcher = vi.fn(async url => url === QWEN_ARTICLE_PAYLOAD_URL
        ? new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
        : new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }))
      const paper = await importQwenBlog({ stageDir, dataDir, fetcher })
      await publishStagedArticle(stageDir, dataDir)
      const directory = path.join(dataDir, 'papers', paper.id)
      const filenames = [path.join(directory, 'source.html'), path.join(directory, 'paper.json'),
        path.join(directory, 'assets', paper.assets[0].filename), path.join(dataDir, 'catalog.json')]
      const before = await Promise.all(filenames.map(filename => readFile(filename)))
      let markEntered
      const entered = new Promise(resolve => { markEntered = resolve })
      held = withExclusivePaperLock(dataDir, paper.id, async () => {
        markEntered()
        await new Promise(resolve => { release = resolve })
      })
      await entered
      await expect(publishStagedArticle(stageDir, dataDir)).rejects.toThrow(/lock timed out.*active owner/)
      const after = await Promise.all(filenames.map(filename => readFile(filename)))
      expect(after).toEqual(before)
      release()
      await held
      held = undefined
      await expect(publishStagedArticle(stageDir, dataDir)).resolves.toMatchObject({ id: paper.id })
    } finally {
      if (held) { release?.(); await held }
      await rm(temp, { recursive: true, force: true })
    }
  })
})
