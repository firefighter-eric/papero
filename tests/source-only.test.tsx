import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { usePaperLibrary } from '../src/hooks/usePaperLibrary'
import { loadPaper, validateCatalog } from '../src/lib/paper-data'
import type { FullTextCatalogPaper, SourceOnlyCatalogPaper } from '../src/types'

const source: SourceOnlyCatalogPaper = {
  id: 'kimi-k3', access: 'source-only', arxivId: '2607.24653v2', sourceKind: 'arxiv',
  title: 'Kimi K3: Open Frontier Intelligence', titleZh: null, authors: ['Kimi Team'],
  year: 2026, tags: ['Kimi', 'MoE'], sourceUrl: 'https://arxiv.org/abs/2607.24653v2',
  sourceHtmlUrl: 'https://arxiv.org/html/2607.24653v2', translationStatus: 'pending',
  blockCount: 0, sectionCount: 0, dataPath: null, abstract: '', abstractZh: '',
}
const full: FullTextCatalogPaper = {
  ...source, id: 'published-paper', access: undefined, title: 'Published report',
  blockCount: 1, sectionCount: 1, dataPath: 'papers/published-paper/paper.json',
}
const fullDocument = {
  schemaVersion: 1, id: full.id, arxivId: full.arxivId, title: full.title, titleZh: null,
  authors: full.authors, year: full.year, tags: full.tags,
  sections: [{ id: 'abstract', title: 'Abstract', titleZh: null }],
  blocks: [{ id: 'block-1', sectionId: 'abstract', kind: 'paragraph', en: '<p>Published body.</p>', zh: null }],
  source: { kind: 'arxiv', url: full.sourceUrl, htmlUrl: full.sourceHtmlUrl, fetchedAt: '2026-10-10T10:00:00.000Z', sha256: 'a'.repeat(64) },
  translation: { status: 'pending' },
}

describe('source-only catalog contract', () => {
  it('accepts multiple source entries alongside an unchanged full-text entry', () => {
    const other = {
      ...source, id: 'kimi-k2', title: 'Kimi K2', arxivId: '2507.20534v2',
      sourceUrl: 'https://arxiv.org/abs/2507.20534v2', sourceHtmlUrl: 'https://arxiv.org/html/2507.20534v2',
    }
    expect(validateCatalog({ schemaVersion: 1, papers: [source, other, full] }).papers).toHaveLength(3)
  })

  it.each([
    { dataPath: full.dataPath }, { blockCount: 1 }, { sectionCount: 1 },
    { translationStatus: 'machine' }, { titleZh: '未经公开的译名' },
    { abstract: 'Copied full abstract.' }, { abstractZh: '复制的中文摘要' },
    { authors: [] }, { blocks: [] }, { content: { format: 'html' } },
    { access: 'unknown' }, { access: undefined }, { sourceKind: undefined },
    { abstract: undefined }, { abstractZh: undefined }, { abstractZh: null },
    { id: 'Kimi-K3' }, { id: 'kimi_k3' }, { id: 'kimi..k3' },
  ])('rejects source metadata that advertises or embeds unpublished body content: %j', (patch) => {
    expect(() => validateCatalog({ schemaVersion: 1, papers: [{ ...source, ...patch }] })).toThrow()
  })

  it.each([
    { arxivId: '2607.24653' }, { arxivId: '2607.24653v0' },
    { sourceUrl: 'https://arxiv.org/abs/2607.24653v1' },
    { sourceHtmlUrl: 'https://arxiv.org/html/2607.24653v1' },
    { sourceUrl: 'https://example.org/abs/2607.24653v2' },
    { sourceHtmlUrl: 'https://arxiv.org.example.com/html/2607.24653v2' },
    { sourceUrl: 'https://arxiv.org/abs/2607.24653v2?version=v1' },
    { sourceHtmlUrl: 'https://arxiv.org/html/2607.24653v2#S1' },
  ])('rejects official links that do not identify the fixed arXiv source: %j', (patch) => {
    expect(() => validateCatalog({ schemaVersion: 1, papers: [{ ...source, ...patch }] })).toThrow(/fixed paper version/)
  })

  it.each([
    'javascript:alert(1)', 'http://arxiv.org/html/2607.24653v2',
    'https://user:password@arxiv.org/html/2607.24653v2', 'https:arxiv.org',
    ' https://arxiv.org/html/2607.24653v2', 'https://arxiv.org/\nhtml/2607.24653v2',
    'https://arxiv.org\\@example.com/html/2607.24653v2',
  ])('rejects unsafe or silently normalized official links: %s', (url) => {
    for (const field of ['sourceUrl', 'sourceHtmlUrl']) {
      expect(() => validateCatalog({ schemaVersion: 1, papers: [{ ...source, [field]: url }] })).toThrow()
    }
  })

  it('never fetches a body when loadPaper is called directly for a source entry', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(loadPaper(source, { fetcher })).rejects.toMatchObject({ code: 'invalid' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

let root: Root | undefined
let host: HTMLDivElement

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/?paper=kimi-k3')
  host = document.createElement('div')
  document.body.append(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(async () => {
  if (root) await act(() => root?.unmount())
  root = undefined
  host.remove()
  vi.unstubAllGlobals()
})

describe('source-only selection', () => {
  it('renders searchable source information and safe official links without body requests or reader controls', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, papers: [source] })))
    vi.stubGlobal('fetch', fetcher)
    root = createRoot(host)
    await act(async () => { root!.render(<App />) })
    expect(host.querySelector('h1')?.textContent).toBe(source.title)
    expect(host.querySelector('h2#paper-source-title')?.textContent).toBe('全文保留在本地')
    expect(host.querySelector('.paper-source-tags')?.textContent).toBe('Kimi · MoE')
    expect(host.querySelector('.paper-card')?.textContent).toContain('来源条目')
    expect(host.querySelector('input[type="search"]')).not.toBeNull()
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.paper-source a'))
    expect(links.map(link => link.href)).toEqual([source.sourceHtmlUrl, source.sourceUrl])
    expect(links.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer')).toBe(true)
    expect(host.querySelector('.reader-toolbar, [role="progressbar"], [role="alert"], [id^="pane-"]')).toBeNull()
    expect(host.textContent).not.toMatch(/正在打开论文|中文翻译待生成|机器翻译/)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toMatch(/catalog\.json$/)
    expect(localStorage.getItem('papero:last-paper:v1')).toBe(source.id)
  })

  it('switches between source entries without fetching a body, then loads an ordinary full-text entry', async () => {
    const other = { ...source, id: 'kimi-k2', title: 'Kimi K2' }
    const fetcher = vi.fn<typeof fetch>((input) => Promise.resolve(new Response(JSON.stringify(
      String(input).endsWith('catalog.json') ? { schemaVersion: 1, papers: [source, other, full] } : fullDocument,
    ))))
    vi.stubGlobal('fetch', fetcher)
    function Harness() {
      const library = usePaperLibrary()
      return <>
        <output>{library.selected?.id}:{library.document.status}:{library.document.value?.id}</output>
        <button onClick={() => library.selectPaper(other.id)}>Other source</button>
        <button onClick={() => library.selectPaper(full.id)}>Full paper</button>
      </>
    }
    root = createRoot(host)
    await act(async () => { root!.render(<Harness />) })
    expect(host.querySelector('output')?.textContent).toBe('kimi-k3:source-only:')
    await act(() => (host.querySelectorAll('button')[0] as HTMLButtonElement).click())
    expect(host.querySelector('output')?.textContent).toBe('kimi-k2:source-only:')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => { (host.querySelectorAll('button')[1] as HTMLButtonElement).click() })
    expect(host.querySelector('output')?.textContent).toBe('published-paper:ready:published-paper')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toMatch(/papers\/published-paper\/paper\.json$/)
  })

  it('does not apply a late full-text response after switching back to a source entry', async () => {
    let finishPaper!: (response: Response) => void
    const response = new Promise<Response>(resolve => { finishPaper = resolve })
    const fetcher = vi.fn<typeof fetch>((input) => String(input).endsWith('catalog.json')
      ? Promise.resolve(new Response(JSON.stringify({ schemaVersion: 1, papers: [source, full] }))) : response)
    vi.stubGlobal('fetch', fetcher)
    function Harness() {
      const library = usePaperLibrary()
      return <>
        <output>{library.selected?.id}:{library.document.status}:{library.document.value?.id}</output>
        <button onClick={() => library.selectPaper(full.id)}>Full paper</button>
        <button onClick={() => library.selectPaper(source.id)}>Source</button>
      </>
    }
    root = createRoot(host)
    await act(async () => { root!.render(<Harness />) })
    await act(() => (host.querySelectorAll('button')[0] as HTMLButtonElement).click())
    expect(host.querySelector('output')?.textContent).toBe('published-paper:loading:')
    await act(() => (host.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true)
    await act(async () => { finishPaper(new Response(JSON.stringify(fullDocument))) })
    expect(host.querySelector('output')?.textContent).toBe('kimi-k3:source-only:')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('labels official article sources generically instead of attributing them to Qwen', async () => {
    const article = { ...source, arxivId: null, sourceKind: 'official-article', sourceUrl: 'https://official.example/blog/m3', sourceHtmlUrl: 'https://official.example/blog/m3' }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, papers: [article] }))))
    root = createRoot(host)
    await act(async () => { root!.render(<App />) })
    expect(host.querySelector('.source-link')?.textContent).toBe('原文 ')
    expect(host.querySelector('.source-link')?.getAttribute('title')).toBe('打开官方发布文章')
    expect(host.textContent).toContain('官方文章')
    expect(host.textContent).not.toContain('Qwen')
    expect(host.querySelectorAll('.paper-source a')).toHaveLength(1)
  })
})
