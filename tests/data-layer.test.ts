import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CatalogPaper, PaperDocument } from '../src/types'
import {
  loadCatalog,
  loadPaper,
  PaperDataError,
  resolvePaperDataUrl,
  sanitizePaperHtml,
  validateCatalog,
  validateDataPath,
  validatePaper,
} from '../src/lib/paper-data'

const entry: CatalogPaper = {
  id: 'attention-is-all-you-need',
  arxivId: '1706.03762v7',
  title: 'Attention Is All You Need',
  titleZh: '注意力就是你所需要的一切',
  authors: ['Ashish Vaswani'],
  year: 2017,
  tags: ['Transformer'],
  sourceUrl: 'https://arxiv.org/abs/1706.03762',
  sourceHtmlUrl: 'https://arxiv.org/html/1706.03762v7',
  translationStatus: 'machine',
  blockCount: 1,
  sectionCount: 1,
  dataPath: 'papers/attention-is-all-you-need/paper.json',
}

function paper(): PaperDocument {
  return {
    schemaVersion: 1,
    id: entry.id,
    arxivId: entry.arxivId,
    title: entry.title,
    titleZh: entry.titleZh,
    authors: entry.authors,
    year: entry.year,
    tags: entry.tags,
    sections: [{ id: 'abstract', title: 'Abstract', titleZh: '摘要', level: 1 }],
    blocks: [{ id: 'block-1', sectionId: 'abstract', kind: 'paragraph', en: '<p>Attention.</p>', zh: '<p>注意力。</p>' }],
    source: {
      url: entry.sourceUrl,
      htmlUrl: entry.sourceHtmlUrl,
      fetchedAt: '2026-10-10T10:00:00.000Z',
      sha256: 'a'.repeat(64),
    },
    translation: { status: 'machine', model: 'qwen3.8-27b-splash', coverage: { complete: 1, total: 1 } },
  }
}

describe('paper data validation', () => {
  it('validates the catalog and linked paper identity and counts', () => {
    expect(validateCatalog({ schemaVersion: 1, papers: [entry] }).papers).toHaveLength(1)
    expect(validatePaper(paper(), entry).id).toBe(entry.id)
    expect(() => validatePaper(paper(), { ...entry, blockCount: 2 })).toThrow(/catalog entry/)
    expect(() => validateCatalog({ schemaVersion: 1, papers: [entry, entry] })).toThrow(/duplicate/)
  })

  it('rejects malformed records and dangling block references', () => {
    const corrupted = paper()
    corrupted.blocks[0].sectionId = 'missing'
    expect(() => validatePaper(corrupted)).toThrow(/unknown section/)
    expect(() => validateCatalog({ schemaVersion: 1, papers: [{ ...entry, authors: 'one author' }] })).toThrow(/string array/)
    expect(() => validateCatalog({ schemaVersion: 2, papers: [] })).toThrow(/schema version/)
  })

  it('accepts explicitly typed official articles without misrepresenting them as arXiv papers', () => {
    const articleEntry: CatalogPaper = {
      ...entry, id: 'qwen3-5-official-article', arxivId: null, sourceKind: 'official-article',
      sourceUrl: 'https://qwen.ai/blog?id=qwen3.5', sourceHtmlUrl: 'https://qwen.ai/blog?id=qwen3.5',
    }
    const article: PaperDocument = {
      ...paper(), id: articleEntry.id, arxivId: null,
      source: { ...paper().source, kind: 'official-article', url: articleEntry.sourceUrl, htmlUrl: articleEntry.sourceHtmlUrl },
    }
    expect(validateCatalog({ schemaVersion: 1, papers: [articleEntry] }).papers[0].arxivId).toBeNull()
    expect(validatePaper(article, articleEntry).source.kind).toBe('official-article')
    expect(() => validateCatalog({ schemaVersion: 1, papers: [{ ...articleEntry, sourceKind: undefined }] })).toThrow(/arxivId/)
    expect(() => validatePaper(article, { ...articleEntry, sourceKind: 'arxiv' })).toThrow(/catalog entry/)
  })

  it.each([
    '../private.json',
    'papers/../../secret.json',
    'papers/%2e%2e/secret.json',
    '/papers/example.json',
    'https://other.example/papers/paper.json',
    'papers/.hidden/paper.json',
    'papers/a\\..\\secret.json',
  ])('rejects a data path outside the storage contract: %s', (value) => {
    expect(() => validateDataPath(value)).toThrow(PaperDataError)
  })

  it('resolves paper data under a configurable HTTPS prefix', () => {
    expect(resolvePaperDataUrl(entry.dataPath, 'https://storage.example/papero/')).toBe(
      'https://storage.example/papero/papers/attention-is-all-you-need/paper.json',
    )
    expect(() => resolvePaperDataUrl(entry.dataPath, 'javascript:alert(1)')).toThrow(PaperDataError)
    expect(() => resolvePaperDataUrl(entry.dataPath, 'https://user:secret@storage.example')).toThrow(PaperDataError)
  })
})

describe('paper fetching', () => {
  it('loads only the catalog until a paper is explicitly requested', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, papers: [entry] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(paper())))
    const options = { baseUrl: 'https://storage.example/data', fetcher }
    const catalog = await loadCatalog(options)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://storage.example/data/catalog.json')
    await loadPaper(catalog.papers[0], options)
    expect(fetcher.mock.calls[1][0]).toContain(entry.dataPath)
    expect(fetcher.mock.calls[1][1]?.credentials).toBe('omit')
  })

  it('reports missing catalog, invalid JSON and network failures distinctly', async () => {
    await expect(loadCatalog({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })) })).rejects.toMatchObject({ code: 'missing' })
    await expect(loadCatalog({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>not json</html>')) })).rejects.toMatchObject({ code: 'invalid' })
    await expect(loadCatalog({ fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')) })).rejects.toMatchObject({ code: 'network' })
  })

  it('revalidates an expired catalog and paper instead of mixing stale counts with new content', async () => {
    const staleEntry = { ...entry, blockCount: 2, titleZh: null, translationStatus: 'pending' }
    const fetcher = vi.fn<typeof fetch>((input, options) => {
      const revalidate = options?.cache === 'no-cache'
      if (String(input).endsWith('catalog.json')) {
        return Promise.resolve(new Response(JSON.stringify({ schemaVersion: 1, papers: [revalidate ? entry : staleEntry] })))
      }
      const stalePaper = { ...paper(), id: 'old-cached-paper' }
      return Promise.resolve(new Response(JSON.stringify(revalidate ? paper() : stalePaper)))
    })
    const catalog = await loadCatalog({ fetcher })
    expect(catalog.papers[0].translationStatus).toBe('machine')
    expect((await loadPaper(catalog.papers[0], { fetcher })).id).toBe(entry.id)
  })

  it('aborts a slow network request at the configured timeout', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    await expect(loadCatalog({ fetcher, timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('bounds response size even when the server omits Content-Length', async () => {
    const oversized = new Response('a'.repeat(2 * 1024 * 1024 + 1))
    await expect(loadCatalog({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(oversized) })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('academic HTML rendering', () => {
  it('renders a MathML equation once without exposing its hidden TeX annotation', () => {
    const tex = '\\mathrm{FFN}(x)=\\max(0,xW_{1}+b_{1})W_{2}+b_{2}'
    const source = `<table class="ltx_equation"><tbody><tr><td><math alttext="${tex}" display="block"><semantics><mrow><mi>FFN</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mfrac><mi>x</mi><mn>2</mn></mfrac></mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></td><td>(2)</td></tr></tbody></table>`
    const rendered = new DOMParser().parseFromString(sanitizePaperHtml(source, entry.dataPath), 'text/html')
    expect(rendered.querySelectorAll('math')).toHaveLength(1)
    expect(rendered.querySelector('math')?.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
    expect(rendered.querySelector('math')?.getAttribute('alttext')).toBe(tex)
    expect(rendered.querySelector('math mfrac')?.textContent).toBe('x2')
    expect(rendered.querySelector('annotation, annotation-xml')).toBeNull()
    expect(rendered.body.textContent).toBe('FFN(x)=x2(2)')
  })

  it('drops complete annotation payloads without removing nearby visible MathML or prose', () => {
    const source = '<p>Visible prose</p><math><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">HIDDEN_TEX<script>alert(1)</script></annotation><annotation-xml encoding="text/html"><div>HIDDEN_HTML<img src="https://bad.example/pixel.png" onerror="alert(2)"></div></annotation-xml></semantics></math><p>After formula</p>'
    const rendered = new DOMParser().parseFromString(sanitizePaperHtml(source, entry.dataPath), 'text/html')
    expect(rendered.querySelector('math mrow')?.textContent).toBe('x+1')
    expect(rendered.body.textContent).toBe('Visible prosex+1After formula')
    expect(rendered.querySelector('annotation, annotation-xml, script, img, [onerror]')).toBeNull()
  })

  it('preserves MathML, tables and figures while removing executable content', () => {
    const html = sanitizePaperHtml(`
      <p onclick="alert(1)" style="position:fixed">Formula <math><msup><mi>x</mi><mn>2</mn></msup></math></p>
      <table><tbody><tr><td>Results</td></tr></tbody></table>
      <figure><img src="assets/figure.png" onerror="alert(1)"><figcaption>Architecture</figcaption></figure>
      <script>alert(1)</script><iframe src="https://bad.example"></iframe>
      <a href="javascript:alert(1)">bad</a><a href="https://arxiv.org/abs/1706.03762">source</a>
    `, entry.dataPath, 'https://storage.example/papero')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('math msup')).not.toBeNull()
    expect(document.querySelector('td')?.textContent).toBe('Results')
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://storage.example/papero/papers/attention-is-all-you-need/assets/figure.png')
    expect(document.querySelector('script, iframe, [onclick], [onerror], [style]')).toBeNull()
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(document.querySelectorAll('a')[1].getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('rejects data URL images and embedded SVG while preserving safe anchors', () => {
    const html = sanitizePaperHtml('<img src="data:image/svg+xml,%3Csvg%20onload=alert(1)%3E"><svg onload="alert(1)"></svg><a href="#section-1">Section</a>', entry.dataPath)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('img')?.hasAttribute('src')).toBe(false)
    expect(document.querySelector('svg')).toBeNull()
    expect(document.querySelector('a')?.getAttribute('href')).toBe('#section-1')
  })
})

describe('processed data export', () => {
  const run = promisify(execFile)

  it('excludes data by default, and opt-in exports HTML documents, body-free metadata and assets', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'papero-data-test-'))
    const dataDir = path.join(fixture, 'data')
    const outDir = path.join(fixture, 'dist')
    const paperDir = path.join(dataDir, 'papers', entry.id)
    try {
      await mkdir(path.join(paperDir, 'assets'), { recursive: true })
      await writeFile(path.join(dataDir, 'catalog.json'), JSON.stringify({ schemaVersion: 1, papers: [entry] }))
      const source = paper()
      const image = '<img src="assets/figure.png" alt="Architecture">'
      source.blocks[0].en += image
      source.blocks[0].zh = `${source.blocks[0].zh ?? ''}${image}`
      await writeFile(path.join(paperDir, 'paper.json'), JSON.stringify({ ...source, assets: [{ filename: 'figure.png', bytes: 10, sha256: createHash('sha256').update('test image').digest('hex') }] }))
      await writeFile(path.join(paperDir, 'source.html'), '<html>raw source</html>')
      await writeFile(path.join(paperDir, 'translation-checkpoint.json'), '{"private":"checkpoint"}')
      await writeFile(path.join(paperDir, 'assets', 'figure.png'), 'test image')
      await run(process.execPath, ['scripts/prepare-data.mjs', '--data-dir', dataDir, '--out-dir', outDir, '--include'])
      expect(await readdir(path.join(outDir, 'paper-data', 'papers', entry.id))).toEqual(['assets', 'en.html', 'paper.json', 'zh.html'])
      const metadata = JSON.parse(await readFile(path.join(outDir, 'paper-data', 'papers', entry.id, 'paper.json'), 'utf8'))
      expect(metadata.content.format).toBe('html')
      expect(metadata.blocks[0]).not.toHaveProperty('en')
      expect(metadata.blocks[0]).not.toHaveProperty('zh')
      expect(JSON.parse(await readFile(path.join(outDir, 'paper-data', 'catalog.json'), 'utf8')).papers).toHaveLength(1)
      await run(process.execPath, ['scripts/prepare-data.mjs', '--data-dir', dataDir, '--out-dir', outDir], { env: { ...process.env, PAPERO_INCLUDE_LOCAL_DATA: '0' } })
      expect(await readdir(outDir)).not.toContain('paper-data')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })
})
