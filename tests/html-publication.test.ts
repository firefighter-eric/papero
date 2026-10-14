import { createHash, webcrypto } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CatalogPaper, PaperDocument } from '../src/types'
import { loadPaper, sanitizePaperHtml } from '../src/lib/paper-data'

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const bytes = (text: string) => Buffer.byteLength(text, 'utf8')
const entry: CatalogPaper = {
  id: 'html-report', arxivId: '2401.00001v1', title: 'HTML Report', titleZh: 'HTML 报告', authors: ['Test Author'],
  year: 2024, tags: ['Testing'], sourceUrl: 'https://arxiv.org/abs/2401.00001v1',
  sourceHtmlUrl: 'https://arxiv.org/html/2401.00001v1', translationStatus: 'machine', blockCount: 3, sectionCount: 1,
  dataPath: 'papers/html-report/paper.json',
}

function publication() {
  const original: PaperDocument = {
    schemaVersion: 1, id: entry.id, arxivId: entry.arxivId, title: entry.title, titleZh: entry.titleZh,
    authors: entry.authors, year: entry.year, tags: entry.tags,
    source: { url: entry.sourceUrl, htmlUrl: entry.sourceHtmlUrl, fetchedAt: '2026-01-01T00:00:00.000Z', sha256: 'a'.repeat(64) },
    translation: { status: 'machine', model: 'test-model', coverage: { complete: 3, total: 3 } },
    sections: [{ id: 'intro', title: 'Introduction', titleZh: '引言', level: 2 }],
    blocks: [
      { id: 'block-001', sourceId: 'intro-title', sectionId: 'intro', kind: 'heading', en: '<h2 id="intro-title">Introduction</h2>', zh: '<h2 id="intro-title">引言</h2>' },
      { id: 'block-002', sourceId: 'intro-body', sectionId: 'intro', kind: 'paragraph',
        en: '<p id="intro-body">The model uses 2 layers. <a href="#intro-title">Section</a><img src="assets/figure.png" alt="Architecture"></p>',
        zh: '<p id="intro-body">模型使用 2 层。<a href="#intro-title">章节</a><img src="assets/figure.png" alt="Architecture"></p>' },
      { id: 'block-003', sourceId: 'formula', sectionId: 'intro', kind: 'equation',
        en: '<math display="block"><semantics><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow><annotation encoding="application/x-tex">x=2</annotation></semantics></math>',
        zh: '<math display="block"><semantics><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow><annotation encoding="application/x-tex">x=2</annotation></semantics></math>' },
    ],
  }
  const offsets: Record<'en' | 'zh', { start: number; end: number }[]> = { en: [], zh: [] }
  const document = (language: 'en' | 'zh') => {
    let html = '<!doctype html><html lang="' + language + '"><head><meta charset="utf-8"><title>Standalone report</title></head><body>'
      + `<article data-paper-id="${original.id}" data-language="${language}">\n`
    for (const block of original.blocks) {
      html += `<div class="paper-block" data-block-id="${block.id}" data-block-kind="${block.kind}" data-source-id="${block.sourceId}" data-section-id="${block.sectionId}">`
      const start = bytes(html)
      html += block[language] ?? ''
      offsets[language].push({ start, end: bytes(html) })
      html += '</div>\n'
    }
    return html + '</article></body></html>'
  }
  const documents = { en: document('en'), zh: document('zh') }
  const metadata = {
    ...original,
    blocks: original.blocks.map(({ en, zh, ...block }, index) => ({ ...block,
      contentSha256: { en: hash(en), zh: zh === null ? null : hash(zh) }, contentOffsets: { en: offsets.en[index], zh: offsets.zh[index] },
    })),
    content: {
      format: 'html',
      en: { path: 'en.html', sha256: hash(documents.en), bytes: bytes(documents.en) },
      zh: { path: 'zh.html', sha256: hash(documents.zh), bytes: bytes(documents.zh) },
    },
  }
  const refresh = (language: 'en' | 'zh') => {
    metadata.content[language].sha256 = hash(documents[language])
    metadata.content[language].bytes = bytes(documents[language])
  }
  const fetcher = vi.fn<typeof fetch>(input => {
    const url = String(input)
    return Promise.resolve(new Response(url.endsWith('paper.json') ? JSON.stringify(metadata) : url.endsWith('en.html') ? documents.en : documents.zh))
  })
  return { original, documents, metadata, refresh, fetcher }
}

beforeAll(() => vi.stubGlobal('crypto', webcrypto))
afterAll(() => vi.unstubAllGlobals())

describe('separate HTML paper publication', () => {
  it('accepts a known section anchor before the hashed body without weakening wrapper boundaries', async () => {
    const sample = publication(), anchor = '<span id="intro"></span>'
    for (const language of ['en', 'zh'] as const) {
      const insertAt = sample.metadata.blocks[0].contentOffsets[language].start
      const before = Buffer.from(sample.documents[language])
      sample.documents[language] = Buffer.concat([before.subarray(0, insertAt), Buffer.from(anchor), before.subarray(insertAt)]).toString()
      for (const block of sample.metadata.blocks) {
        block.contentOffsets[language].start += bytes(anchor)
        block.contentOffsets[language].end += bytes(anchor)
      }
      sample.refresh(language)
    }
    const paper = await loadPaper(entry, { fetcher: sample.fetcher })
    expect(paper.blocks.map(block => block.en)).toEqual(sample.original.blocks.map(block => block.en))
    expect(paper.blocks.map(block => block.zh)).toEqual(sample.original.blocks.map(block => block.zh))
    sample.documents.en = sample.documents.en.replace(anchor, '<span id="other"></span>')
    sample.refresh('en')
    await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toThrow(/wrapper boundaries/)
  })

  it('loads checked English and Chinese documents and reconstructs exact formulas, assets and ordered blocks in memory', async () => {
    const sample = publication()
    const paper = await loadPaper(entry, { baseUrl: 'https://storage.example/papero', fetcher: sample.fetcher })
    expect(sample.fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://storage.example/papero/papers/html-report/paper.json',
      'https://storage.example/papero/papers/html-report/en.html',
      'https://storage.example/papero/papers/html-report/zh.html',
    ])
    for (const [index, block] of paper.blocks.entries()) {
      expect(block.en).toBe(sample.original.blocks[index].en)
      expect(block.zh).toBe(sample.original.blocks[index].zh)
    }
    for (const [, options] of sample.fetcher.mock.calls.slice(1)) {
      expect(options).toMatchObject({ credentials: 'omit', cache: 'no-cache', headers: { Accept: 'text/html' } })
    }
    const rendered = new DOMParser().parseFromString(sanitizePaperHtml(paper.blocks[2].en, entry.dataPath), 'text/html')
    expect(rendered.querySelectorAll('math')).toHaveLength(1)
    expect(rendered.querySelector('math mrow')?.textContent).toBe('x=2')
    expect(rendered.querySelector('annotation')).toBeNull()
  })

  it('retains empty Chinese blocks as pending rather than silently inventing translated text', async () => {
    const sample = publication()
    sample.documents.zh = sample.documents.zh.replace(sample.original.blocks[1].zh!, '')
    sample.metadata.blocks[1].contentSha256.zh = null
    const removed = bytes(sample.original.blocks[1].zh!)
    sample.metadata.blocks[1].contentOffsets.zh.end = sample.metadata.blocks[1].contentOffsets.zh.start
    sample.metadata.blocks[2].contentOffsets.zh.start -= removed
    sample.metadata.blocks[2].contentOffsets.zh.end -= removed
    sample.metadata.translation.status = 'pending'
    sample.metadata.translation.coverage!.complete = 2
    sample.refresh('zh')
    const paper = await loadPaper({ ...entry, translationStatus: 'pending' }, { fetcher: sample.fetcher })
    expect(paper.blocks[1].zh).toBeNull()
    expect(paper.blocks[1].en).toBe(sample.original.blocks[1].en)
  })

  it.each(['../en.html', 'https://outside.example/en.html', 'zh.html'])('rejects an English document path outside the filename contract before fetching it: %s', async path => {
    const sample = publication()
    sample.metadata.content.en.path = path
    await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toMatchObject({ code: 'invalid' })
    expect(sample.fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects mixed JSON/HTML body metadata and invalid block fingerprints before fetching documents', async () => {
    for (const change of [
      (sample: ReturnType<typeof publication>) => Object.assign(sample.metadata.blocks[0], { en: '<p>Hidden JSON body</p>' }),
      (sample: ReturnType<typeof publication>) => { sample.metadata.blocks[0].contentSha256.en = 'invalid' },
    ]) {
      const sample = publication()
      change(sample)
      await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toMatchObject({ code: 'invalid' })
      expect(sample.fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('rejects stale HTML bytes or an incorrect whole-document SHA before interpreting its contents', async () => {
    for (const change of [
      (sample: ReturnType<typeof publication>) => { sample.documents.zh += ' ' },
      (sample: ReturnType<typeof publication>) => { sample.metadata.content.zh.sha256 = 'b'.repeat(64) },
      (sample: ReturnType<typeof publication>) => { sample.metadata.content.zh.bytes -= 1 },
    ]) {
      const sample = publication()
      change(sample)
      await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toThrow(/published fingerprint/)
    }
  })

  it.each([
    ['paper identity', (html: string) => html.replace('data-paper-id="html-report"', 'data-paper-id="other-report"')],
    ['language identity', (html: string) => html.replace('data-language="zh"', 'data-language="en"')],
    ['block order', (html: string) => html.replace('data-block-id="block-001"', 'data-block-id="block-002"')],
    ['block kind', (html: string) => html.replace('data-block-kind="heading"', 'data-block-kind="table"')],
    ['source locator', (html: string) => html.replace('data-source-id="intro-title"', 'data-source-id="other-title"')],
    ['section', (html: string) => html.replace('data-section-id="intro"', 'data-section-id="other-section"')],
    ['missing block', (html: string) => html.replace(/<div class="paper-block" data-block-id="block-001"[^>]*>[\s\S]*?<\/div>/, '')],
    ['extra prose', (html: string) => html.replace('</article>', 'Extra content</article>')],
  ])('rejects a complete HTML file whose %s disagrees with metadata', async (_label, change) => {
    const sample = publication()
    sample.documents.zh = change(sample.documents.zh)
    sample.refresh('zh')
    await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('rejects body tampering even if the whole-document fingerprint has been updated', async () => {
    const sample = publication()
    sample.documents.zh = sample.documents.zh.replace('模型使用 2 层', '模型使用 3 层')
    sample.refresh('zh')
    await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toThrow(/block fingerprint/)
  })

  it('parses standalone head content inertly without executing scripts or applying its styles to the reader', async () => {
    const sample = publication()
    const added = '<style>body{display:none}</style><script>globalThis.paperHtmlExecuted=true</script>'
    sample.documents.en = sample.documents.en.replace('</head>', `${added}</head>`)
    for (const block of sample.metadata.blocks) { block.contentOffsets.en.start += bytes(added); block.contentOffsets.en.end += bytes(added) }
    sample.refresh('en')
    await loadPaper(entry, { fetcher: sample.fetcher })
    expect((globalThis as typeof globalThis & { paperHtmlExecuted?: boolean }).paperHtmlExecuted).toBeUndefined()
    expect(document.head.querySelector('style')).toBeNull()
    expect(document.querySelector('article[data-paper-id="html-report"], img[src="assets/figure.png"]')).toBeNull()
  })

  it('rejects non-UTF-8 document bytes rather than hashing replacement characters', async () => {
    const sample = publication()
    const fetcher = vi.fn<typeof fetch>(input => String(input).endsWith('en.html')
      ? Promise.resolve(new Response(new Uint8Array([0xc3, 0x28]))) : sample.fetcher(input))
    await expect(loadPaper(entry, { fetcher })).rejects.toThrow(/invalid UTF-8/)
  })

  it('uses original UTF-8 bytes even when browser innerHTML serialization changes MathML attributes', async () => {
    const sample = publication()
    const formula = '<math alttext="k<n"><mrow><mi>k</mi><mo>&lt;</mo><mi>n</mi></mrow></math>'
    const delta = bytes(formula) - bytes(sample.original.blocks[2].en)
    sample.documents.en = sample.documents.en.replace(sample.original.blocks[2].en, formula)
    sample.metadata.blocks[2].contentSha256.en = hash(formula)
    sample.metadata.blocks[2].contentOffsets.en.end += delta
    sample.refresh('en')
    const originalGetter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!.get!
    const serialization = vi.spyOn(Element.prototype, 'innerHTML', 'get').mockImplementation(function (this: Element) {
      return originalGetter.call(this).replaceAll('alttext="k<n"', 'alttext="k&lt;n"')
    })
    try { expect((await loadPaper(entry, { fetcher: sample.fetcher })).blocks[2].en).toBe(formula) }
    finally { serialization.mockRestore() }
  })

  it('rejects overlapping, out-of-bounds and UTF-8-splitting block byte offsets', async () => {
    for (const change of [
      (sample: ReturnType<typeof publication>) => { sample.metadata.blocks[1].contentOffsets.zh.start = sample.metadata.blocks[0].contentOffsets.zh.start },
      (sample: ReturnType<typeof publication>) => { sample.metadata.blocks[1].contentOffsets.zh.end = sample.metadata.content.zh.bytes + 1 },
      (sample: ReturnType<typeof publication>) => { sample.metadata.blocks[0].contentOffsets.zh.end -= 1 },
    ]) {
      const sample = publication()
      change(sample)
      await expect(loadPaper(entry, { fetcher: sample.fetcher })).rejects.toMatchObject({ code: 'invalid' })
    }
  })

  it('cancels both HTML fetches when the reader leaves a paper', async () => {
    const sample = publication(), controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>((input, options) => {
      if (String(input).endsWith('paper.json')) return Promise.resolve(new Response(JSON.stringify(sample.metadata)))
      const pending = new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      if (String(input).endsWith('zh.html')) queueMicrotask(() => controller.abort())
      return pending
    })
    await expect(loadPaper(entry, { fetcher, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
