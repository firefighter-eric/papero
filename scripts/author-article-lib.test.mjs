import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { load } from 'cheerio'
import { AUTHOR_ARTICLES, authorArticleProfile, authorArticleAssetUrl, prepareAuthorArticleHtml,
  parseAuthorArticle, assertAuthorArticleProvenance } from './author-article-lib.mjs'
import { importAuthorArticle, registerStagedAuthorArticle } from './import-author-article.mjs'
import { sha256, translationUnits } from './paper-lib.mjs'
import { withExclusivePaperLock } from './catalog-lock.mjs'

const profile = AUTHOR_ARTICLES['muon-original-design']
const imageUrl = 'https://kellerjordan.github.io/images/muon/test.svg'
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><rect width="10" height="10" onclick="bad()"/></svg>'
const fixture = `<html><head><title>${profile.title} | ${profile.publisher}</title><link rel="canonical" href="${profile.url}"></head>
<body><div class="logo"><a>${profile.publisher}</a></div><article class="post-single"><header><h1 class="post-title">${profile.title}</h1>
<div class="post-meta">December 8, 2024 · 17 min</div></header><div class="post-content">
<p>Full introduction <strong>must survive</strong>.</p><h2 id="definition">Definition<a class="anchor" href="#definition">#</a></h2>
<p>First source formula: $G = USV^\\top$.</p><div class="highlight"><pre><code class="language-python">print('$not_formula')\nassert x &lt; 2</code></pre></div>
<p><img src="/images/muon/test.svg" alt="source diagram">Figure 1. Original caption with a <a href="/posts/muon/#definition">source link</a>.</p>
<p>$$\\mathrm{Ortho}(G)=\\arg\\min_O\\{\\|O-G\\|_F : \\text{either $O^\\top O=I$ or $OO^\\top=I$}\\}$$</p>
<p>\\begin{align*} W_{t+1}&amp;=W_t-\\eta G_t\\\\ &amp;= W_t-\\eta UV^\\top \\end{align*}</p>
<h3 id="reference-note">Source notes</h3><p>I am the author; trust me (Keller Jordan). See <a href="#definition">Definition</a>.</p>
<p>Note: This subsection was added on 07/12/2025.</p><h2 id="references">References</h2><ol><li>Exact cited reference 2024.</li></ol>
<h2 id="citation">Citation</h2><pre><code>@misc{jordan2024muon, author={Keller Jordan and Jeremy Bernstein}, title={${profile.title}}}</code></pre>
<script>alert('removed')</script></div></article><footer>Not part of article</footer></body></html>`

function fetcher(html = fixture) {
  const calls = []
  return { calls, async fetch(url) {
    calls.push(url)
    if (url === profile.url) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    if (url === imageUrl) return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
    throw new Error(`Unexpected URL ${url}`)
  } }
}

test('author article preserves the complete content, source TeX, code, captions and anchors in order', () => {
  const prepared = prepareAuthorArticleHtml(fixture, profile)
  prepared.content.find('img').attr('src', 'assets/diagram.svg')
  const paper = parseAuthorArticle(prepared, { id: profile.id, html: fixture, fetchedAt: '2026-10-11T01:00:00.000Z',
    assets: [], processorSha256: 'a'.repeat(64) })
  const $ = load(paper.blocks.map(block => block.en).join('\n'), {}, false)
  assert.equal(paper.source.kind, 'official-article')
  assert.equal(paper.arxivId, null)
  assert.deepEqual(paper.authors, ['Keller Jordan'])
  assert.equal(paper.source.publishedAt, '2024-12-08')
  assert.equal(paper.source.publishedDatePrecision, 'day')
  assert.equal($('math').length, 3)
  assert.equal($('annotation').length, 3)
  assert.match($('annotation').last().text(), /\\begin\{align\*\}/)
  assert.match($('annotation').eq(1).text(), /\$O\^\\top O=I\$/)
  assert.equal($('pre').first().text(), "print('$not_formula')\nassert x < 2")
  assert.equal($('a[href="#definition"]').length, 1)
  assert.equal($(`a[href="${profile.url}#definition"]`).length, 1)
  assert.equal($('img').attr('src'), 'assets/diagram.svg')
  assert.match($.text(), /Figure 1\. Original caption/)
  assert.match($.text(), /Exact cited reference 2024/)
  assert(!$.text().includes('Not part of article'))
  assert(!$.text().includes("alert('removed')"))
  assert(!$.text().includes('Definition#'))
  assert.deepEqual(paper.sections.map(section => [section.id, section.level]),
    [['introduction', 1], ['definition', 2], ['reference-note', 3], ['references', 2], ['citation', 2]])
  assert.deepEqual(paper.source.revisionNotes, ['Note: This subsection was added on 07/12/2025.'])
  const formula = paper.blocks.find(block => block.en.includes('source formula'))
  assert(!translationUnits(formula.en).units.some(unit => unit.text.includes('USV')))
})

test('author article recipe rejects source identity drift, unsafe assets, broken anchors and unsupported source TeX', () => {
  assert.throws(() => authorArticleProfile('../../other'), /Unsupported author/)
  for (const value of ['https://evil.example/images/muon/a.png', '/images/other/a.png', '/images/muon/a.svg?x=1', 'javascript:alert(1)']) {
    assert.throws(() => authorArticleAssetUrl(value, profile), /Unsupported author article asset/)
  }
  for (const changed of [fixture.replace('December 8, 2024', 'December 9, 2024'), fixture.replace('class="post-title">Muon:', 'class="post-title">Other:'),
    fixture.replace(`href="${profile.url}"`, 'href="https://evil.example/posts/muon/'), fixture.replaceAll(profile.author, 'Other Author')]) {
    assert.throws(() => prepareAuthorArticleHtml(changed, profile), /source identity/)
  }
  assert.throws(() => prepareAuthorArticleHtml(fixture.replace('$G = USV^\\top$', '$\\unknownSourceCommand{G}$'), profile), /formula cannot be rendered/)
  const broken = prepareAuthorArticleHtml(fixture.replace('href="#definition">Definition', 'href="#missing">Definition'), profile)
  broken.content.find('img').attr('src', 'assets/diagram.svg')
  assert.throws(() => parseAuthorArticle(broken, { id: profile.id, html: fixture, fetchedAt: new Date().toISOString(), assets: [], processorSha256: 'a'.repeat(64) }), /Broken author article internal link/)
})

test('import stages untouched source and original/sanitized assets, uses actual fetch time and registers locally without re-fetching', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'papero-author-article-'))
  try {
    const stageDir = path.join(temp, 'stage'), dataDir = path.join(temp, 'data'), f = fetcher()
    const before = Date.now()
    const paper = await importAuthorArticle({ stageDir, dataDir, fetcher: f.fetch })
    const after = Date.now()
    assert.deepEqual(await readdir(temp), ['stage'])
    assert.equal(await readFile(path.join(stageDir, 'source.html'), 'utf8'), fixture)
    assert.equal(paper.source.sha256, sha256(fixture))
    assert(Date.parse(paper.source.fetchedAt) >= before && Date.parse(paper.source.fetchedAt) <= after)
    const asset = paper.assets[0]
    assert.equal(asset.sourceSha256, sha256(svg))
    assert.equal(await readFile(path.join(stageDir, 'source-assets', asset.filename), 'utf8'), svg)
    const sanitized = await readFile(path.join(stageDir, 'assets', asset.filename), 'utf8')
    assert(!sanitized.includes('script') && !sanitized.includes('onclick'))
    assert.equal(asset.sha256, sha256(sanitized))
    await registerStagedAuthorArticle(stageDir, dataDir)
    const storedFile = path.join(dataDir, 'papers', paper.id, 'paper.json')
    paper.blocks[0].zh = '<p>完整引言<strong>必须保留</strong>。</p>'
    paper.titleZh = 'Muon 原始设计'
    paper.translation.coverage.complete = 1
    await writeFile(storedFile, JSON.stringify(paper))
    await importAuthorArticle({ stageDir, dataDir, registerLocal: true, fetcher: f.fetch })
    const registered = JSON.parse(await readFile(storedFile, 'utf8'))
    assert.equal(registered.blocks[0].zh, paper.blocks[0].zh)
    assert.equal(registered.titleZh, paper.titleZh)
    assert.equal(registered.source.fetchedAt, paper.source.fetchedAt)
    assert.equal(f.calls.length, 2)
    const catalog = JSON.parse(await readFile(path.join(dataDir, 'catalog.json'), 'utf8'))
    assert.equal(catalog.papers[0].id, profile.id)
    assert.equal(catalog.papers[0].sourceUrl, profile.url)
    assert.equal(catalog.papers[0].sourceKind, 'official-article')
  } finally { await rm(temp, { recursive: true, force: true }) }
})

test('staging tampering and extraction drift are rejected before changing registered article or catalog', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'papero-author-integrity-'))
  try {
    const stageDir = path.join(temp, 'stage'), dataDir = path.join(temp, 'data'), f = fetcher()
    const paper = await importAuthorArticle({ stageDir, dataDir, registerLocal: true, fetcher: f.fetch })
    const storedFile = path.join(dataDir, 'papers', paper.id, 'paper.json')
    const catalogFile = path.join(dataDir, 'catalog.json')
    const before = await Promise.all([readFile(storedFile), readFile(catalogFile)])
    await writeFile(path.join(stageDir, 'source.html'), fixture + 'tampered')
    await assert.rejects(registerStagedAuthorArticle(stageDir, dataDir), /source fingerprint/)
    await writeFile(path.join(stageDir, 'source.html'), fixture)
    await writeFile(path.join(stageDir, 'assets', paper.assets[0].filename), 'tampered')
    await assert.rejects(registerStagedAuthorArticle(stageDir, dataDir), /asset fingerprint/)
    await writeFile(path.join(stageDir, 'assets', paper.assets[0].filename), await readFile(path.join(dataDir, 'papers', paper.id, 'assets', paper.assets[0].filename)))
    const changed = structuredClone(paper)
    changed.blocks[0].en = '<p>Truncated source introduction.</p>'
    await writeFile(path.join(stageDir, 'paper.json'), JSON.stringify(changed))
    await assert.rejects(registerStagedAuthorArticle(stageDir, dataDir), /staged extraction changed/)
    assert.deepEqual(await Promise.all([readFile(storedFile), readFile(catalogFile)]), before)
    assert.throws(() => assertAuthorArticleProvenance({ ...paper, authors: ['Other Author'] }), /Invalid author article provenance/)
    assert.throws(() => assertAuthorArticleProvenance({ ...paper, source: { ...paper.source, url: 'https://evil.example/' } }), /Invalid author article provenance/)
  } finally { await rm(temp, { recursive: true, force: true }) }
})

test('same-source asset changes and active paper ownership preserve registered translations and catalog', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'papero-author-owner-'))
  let release, held
  try {
    const stageDir = path.join(temp, 'stage'), dataDir = path.join(temp, 'data'), f = fetcher()
    const paper = await importAuthorArticle({ stageDir, dataDir, registerLocal: true, fetcher: f.fetch })
    const storedFile = path.join(dataDir, 'papers', paper.id, 'paper.json'), catalogFile = path.join(dataDir, 'catalog.json')
    const before = await Promise.all([readFile(storedFile), readFile(catalogFile)])
    let entered
    const started = new Promise(resolve => { entered = resolve })
    held = withExclusivePaperLock(dataDir, paper.id, async () => { entered(); await new Promise(resolve => { release = resolve }) })
    await started
    await assert.rejects(registerStagedAuthorArticle(stageDir, dataDir), /lock timed out.*active owner/)
    assert.deepEqual(await Promise.all([readFile(storedFile), readFile(catalogFile)]), before)
    release(); await held; held = undefined
    await assert.rejects(importAuthorArticle({ stageDir, dataDir, registerLocal: true, refresh: true,
      fetcher: async url => url === profile.url ? new Response(fixture, { headers: { 'content-type': 'text/html' } })
        : new Response(svg.replace('width="10"', 'width="11"'), { headers: { 'content-type': 'image/svg+xml' } }) }), /assets changed/)
    assert.deepEqual(await Promise.all([readFile(storedFile), readFile(catalogFile)]), before)
  } finally { if (held) { release?.(); await held }; await rm(temp, { recursive: true, force: true }) }
})

test('cached raw and sanitized asset fingerprints are checked without silently refreshing corrupted files', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'papero-author-cache-'))
  try {
    const stageDir = path.join(temp, 'stage'), f = fetcher()
    const paper = await importAuthorArticle({ stageDir, fetcher: f.fetch })
    await writeFile(path.join(stageDir, 'source-assets', paper.assets[0].filename), 'tampered')
    await assert.rejects(importAuthorArticle({ stageDir, fetcher: f.fetch }), /Cached author article asset fingerprint/)
    assert.equal(f.calls.length, 2)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
