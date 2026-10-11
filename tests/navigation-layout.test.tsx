import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/components/Sidebar'
import { TableOfContents } from '../src/components/TableOfContents'
import { useLibraryPanel } from '../src/hooks/useLibraryPanel'
import type { CatalogPaper, PaperSection } from '../src/types'

const papers: CatalogPaper[] = [
  ['old-qwen', 'Qwen 2024', 2024, 'Qwen'],
  ['deepseek', 'DeepSeek Report', 2025, 'DeepSeek'],
  ['new-qwen', 'Qwen 2026', 2026, 'Qwen'],
].map(([id, title, year, family]) => ({
  id: String(id), title: String(title), year: Number(year), tags: [String(family), '预训练'],
  arxivId: '2401.00001v1', titleZh: null, authors: ['Research Team'], translationStatus: 'pending',
  sourceUrl: 'https://arxiv.org/abs/2401.00001v1', sourceHtmlUrl: 'https://arxiv.org/html/2401.00001v1',
  blockCount: 1, sectionCount: 1, dataPath: `papers/${id}/paper.json`,
}))
const sections: PaperSection[] = [
  { id: 'intro', title: 'Introduction', titleZh: '引言', level: 1 },
  { id: 'method', title: 'Method', titleZh: '方法', level: 2 },
  { id: 'detail', title: 'Detail', titleZh: '细节', level: 3 },
  { id: 'results', title: 'Results', titleZh: '结果', level: 1 },
]
let root: Root
let host: HTMLDivElement
let compact: boolean

beforeEach(() => {
  localStorage.clear()
  compact = false
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: compact, addEventListener() {}, removeEventListener() {} })))
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function button(label: string) {
  const match = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .filter(element => element.tabIndex !== -1)
    .find(element => element.getAttribute('aria-label') === label || element.textContent === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

function LayoutPreference() {
  const [collapsed, setCollapsed] = useLibraryPanel()
  return <button aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>切换检索栏</button>
}

describe('independent library and table of contents', () => {
  it('defaults to a collapsed library on narrow screens and restores an explicit preference after remounting', async () => {
    compact = true
    await act(() => root.render(<LayoutPreference />))
    expect(button('切换检索栏').getAttribute('aria-expanded')).toBe('false')
    await act(() => button('切换检索栏').click())
    expect(localStorage.getItem('papero:library-panel:v1')).toBe('false')
    await act(() => root.render(null))
    await act(() => root.render(<LayoutPreference />))
    expect(button('切换检索栏').getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the layout toggle usable when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
    await act(() => root.render(<LayoutPreference />))
    await act(() => button('切换检索栏').click())
    expect(button('切换检索栏').getAttribute('aria-expanded')).toBe('false')
  })

  it('retains filters, sort order, and list position when the library is folded, without mounting a directory inside it', async () => {
    const onSelect = vi.fn()
    const renderLibrary = (collapsed: boolean) => <Sidebar papers={papers} selectedId={papers[0].id}
      mobile={false} open={false} collapsed={collapsed} remoteData={false} loading={false}
      onClose={() => {}} onToggle={() => {}} onSelect={onSelect} />
    await act(() => root.render(renderLibrary(false)))
    const family = host.querySelectorAll<HTMLSelectElement>('select')[0]
    const sort = host.querySelectorAll<HTMLSelectElement>('select')[2]
    await act(() => {
      family.value = 'Qwen'
      family.dispatchEvent(new Event('change', { bubbles: true }))
      sort.value = 'year'
      sort.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const list = host.querySelector<HTMLElement>('.paper-list')!
    list.scrollTop = 145
    await act(() => list.dispatchEvent(new Event('scroll', { bubbles: true })))
    expect(Array.from(list.querySelectorAll('.paper-card-title')).map(item => item.textContent)).toEqual(['Qwen 2026', 'Qwen 2024'])
    await act(() => root.render(renderLibrary(true)))
    list.scrollTop = 0 // Browsers may discard the scroll box while its ancestor is hidden.
    expect(host.querySelector<HTMLElement>('#paper-library-content')!.hidden).toBe(true)
    expect(button('展开论文检索栏').getAttribute('aria-expanded')).toBe('false')
    await act(() => root.render(renderLibrary(false)))
    expect(family.value).toBe('Qwen')
    expect(sort.value).toBe('year')
    expect(list.scrollTop).toBe(145)
    await act(() => list.querySelector<HTMLButtonElement>('.paper-card')!.click())
    expect(onSelect).toHaveBeenCalledWith('new-qwen')
    expect(host.querySelector('.toc')).toBeNull()
  })

  it('expands ancestors of the active section and keeps section toggling separate from navigation', async () => {
    const onNavigate = vi.fn()
    const renderContents = (activeSection: string) => <TableOfContents entry={papers[0]} sections={sections}
      activeSection={activeSection} mobile={false} open={false} loading={false} onClose={() => {}} onNavigate={onNavigate} />
    await act(() => root.render(renderContents('intro')))
    await act(() => button('折叠引言的子章节').click())
    expect(button('展开引言的子章节').getAttribute('aria-expanded')).toBe('false')
    expect(button('方法').closest<HTMLElement>('ul')!.hidden).toBe(true)
    expect(onNavigate).not.toHaveBeenCalled()
    await act(() => root.render(renderContents('detail')))
    expect(button('折叠引言的子章节').getAttribute('aria-expanded')).toBe('true')
    expect(button('细节').getAttribute('aria-current')).toBe('location')
    await act(() => button('方法').click())
    expect(onNavigate).toHaveBeenCalledWith('method')
  })

  it('traps focus in the mobile directory and restores it to the opener on Escape', async () => {
    function MobileContents() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>打开目录</button>
        <TableOfContents entry={papers[0]} sections={sections} activeSection="intro" mobile open={open}
          loading={false} onClose={() => setOpen(false)} onNavigate={() => {}} /></>
    }
    await act(() => root.render(<MobileContents />))
    const opener = button('打开目录')
    opener.focus()
    await act(() => opener.click())
    const close = button('关闭本文目录')
    expect(document.activeElement).toBe(close)
    await act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })))
    expect(document.activeElement).toBe(button('结果'))
    await act(() => button('结果').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
    expect(document.activeElement).toBe(close)
    await act(() => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(host.querySelector('#paper-toc')!.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('#paper-toc')!.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(opener)
  })
})
