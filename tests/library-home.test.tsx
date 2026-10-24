import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { CatalogPaper } from '../src/types'

const papers: CatalogPaper[] = [
  { id: 'vision-old', title: 'Vision foundation', titleZh: '视觉基础', year: 2012, tags: ['经典论文', '计算机视觉', 'AlexNet'] },
  { id: 'vision-new', title: 'Vision transformer', titleZh: '视觉 Transformer', year: 2021, tags: ['计算机视觉', 'ViT'] },
  { id: 'language', title: 'Language report', titleZh: '语言报告', year: 2024, tags: ['Qwen', '预训练'] },
].map(paper => ({ ...paper, arxivId: '2401.00001v1', authors: ['Research Team'],
  translationStatus: 'machine', blockCount: 1, sectionCount: 1,
  sourceUrl: 'https://arxiv.org/abs/2401.00001v1', sourceHtmlUrl: 'https://arxiv.org/html/2401.00001v1', dataPath: `papers/${paper.id}/paper.json`,
}))

vi.mock('../src/components/PaperReader', () => ({ PaperReader: () => <div data-testid="reader">正文阅读器</div> }))
let root: Root
let host: HTMLDivElement
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
  fetcher = vi.fn<typeof fetch>(async input => {
    const url = String(input)
    if (url.endsWith('/research/catalog.json')) return new Response(JSON.stringify({ schemaVersion: 1, reports: [] }))
    if (url.endsWith('/catalog.json')) return new Response(JSON.stringify({ schemaVersion: 1, papers }))
    const paper = papers.find(entry => url.endsWith(entry.dataPath!))!
    return new Response(JSON.stringify({ schemaVersion: 1, ...paper, sections: [{ id: 'abstract', title: 'Abstract', titleZh: '摘要' }],
      blocks: [{ id: 'block-1', sectionId: 'abstract', kind: 'paragraph', en: '<p>Body.</p>', zh: '<p>正文。</p>' }],
      source: { url: paper.sourceUrl, htmlUrl: paper.sourceHtmlUrl, fetchedAt: '2026-10-15T00:00:00Z', sha256: 'a'.repeat(64) }, translation: { status: 'machine' } }))
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(async () => {
  await act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})
const render = () => act(async () => { root.render(<App />) })
const link = (selector: string) => host.querySelector<HTMLAnchorElement>(selector)!
const titles = () => Array.from(host.querySelectorAll('.home-paper-card h3')).map(element => element.textContent)

describe('category home navigation', () => {
  it('opens the category home even with a saved last paper and only fetches catalogs', async () => {
    localStorage.setItem('papero:last-paper:v1', 'language')
    await render()
    expect(host.querySelector('h1')?.textContent).toBe('从一个方向，读进 AI。')
    expect(titles()).toHaveLength(3)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(window.location.search).toBe('')
    expect(host.querySelector('.reader-toolbar')).toBeNull()
  })

  it('opens a category, a paper, and the same category again, preserving browser back/forward routes', async () => {
    await render()
    await act(() => link('.category-card[href="/?category=vision"]').click())
    expect(titles()).toEqual(['视觉基础', '视觉 Transformer'])
    expect(host.querySelector('h1')?.textContent).toBe('计算机视觉与多模态')
    expect(host.querySelector('.category-grid')).toBeNull()
    const categoryUrl = window.location.href
    await act(() => link('.home-paper-card h3 a').click())
    expect(window.location.search).toBe('?category=vision&paper=vision-old')
    expect(host.querySelector('[data-testid="reader"]')).not.toBeNull()
    const paperUrl = window.location.href
    await act(() => link('[aria-label="返回论文分类"]').click())
    expect(window.location.href).toBe(categoryUrl)
    expect(titles()).toHaveLength(2)
    // Popstate restores routes rather than opening the saved last paper over the home.
    await act(async () => { history.replaceState(null, '', paperUrl); dispatchEvent(new PopStateEvent('popstate')) })
    expect(host.querySelector('[data-testid="reader"]')).not.toBeNull()
    await act(async () => { history.replaceState(null, '', categoryUrl); dispatchEvent(new PopStateEvent('popstate')) })
    expect(titles()).toHaveLength(2)
    await act(() => link('[aria-label="Papero 分类主页"]').click())
    expect(window.location.search).toBe('')
    expect(titles()).toHaveLength(3)
  })

  it('restores category, family, search and sort from a shared URL', async () => {
    history.replaceState(null, '', '/?category=vision&family=ViT&q=transformer&sort=year')
    await render()
    expect(titles()).toEqual(['视觉 Transformer'])
    expect(host.querySelector<HTMLInputElement>('.home-search input')?.value).toBe('transformer')
    expect(Array.from(host.querySelectorAll('select')).map(select => select.value)).toEqual(['ViT', 'year'])
    expect(fetcher).toHaveBeenCalledTimes(2)
    await act(() => { const family = host.querySelector<HTMLSelectElement>('select')!; family.value = 'Qwen'; family.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.textContent).toContain('没有找到匹配的论文')
    await act(() => link('.home-no-results a').click())
    expect(titles()).toHaveLength(3)
  })

  it('keeps modified paper and category links native for opening a new tab', async () => {
    await render()
    const event = new MouseEvent('click', { button: 0, metaKey: true, bubbles: true, cancelable: true })
    const nativeNavigation = vi.fn((click: MouseEvent) => {
      expect(click.defaultPrevented).toBe(false)
      click.preventDefault() // JSDOM cannot perform the native new-tab navigation.
    })
    document.addEventListener('click', nativeNavigation, { once: true })
    link('.category-card[href="/?category=vision"]').dispatchEvent(event)
    expect(nativeNavigation).toHaveBeenCalledOnce()
    expect(window.location.search).toBe('')
    const paperLink = link('.home-paper-card h3 a')
    expect(paperLink.getAttribute('href')).toBe('/?paper=vision-old')
  })

  it('opens a direct paper link and makes the Papero mark return to the category home', async () => {
    history.replaceState(null, '', '/?paper=vision-old')
    await render()
    expect(host.querySelector('[data-testid="reader"]')).not.toBeNull()
    await act(() => link('[aria-label="Papero 分类主页"]').click())
    expect(host.querySelector('h1')?.textContent).toBe('从一个方向，读进 AI。')
    expect(window.location.search).toBe('')
  })
})
