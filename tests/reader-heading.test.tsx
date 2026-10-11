import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperHeader } from '../src/components/PaperHeader'
import { PaperReader } from '../src/components/PaperReader'
import type { ReadingPosition } from '../src/components/PaperReader'
import type { ReaderPreferences } from '../src/hooks/usePreferences'
import type { FullTextCatalogPaper, PaperDocument } from '../src/types'

const entry: FullTextCatalogPaper = {
  id: 'heading-fixture', arxivId: '1706.03762v7', title: 'A report with front matter',
  titleZh: '带有前置信息的报告', authors: ['Research Team'], year: 2026, tags: ['预训练'],
  sourceUrl: 'https://arxiv.org/abs/1706.03762v7', sourceHtmlUrl: 'https://arxiv.org/html/1706.03762v7',
  translationStatus: 'machine', blockCount: 4, sectionCount: 4,
  dataPath: 'papers/heading-fixture/paper.json',
}
const paper: PaperDocument = {
  schemaVersion: 1, id: entry.id, arxivId: entry.arxivId, title: entry.title,
  titleZh: entry.titleZh, authors: entry.authors, year: entry.year, tags: entry.tags,
  sections: ['frontmatter', 'abstract', 'introduction', 'results'].map(id => ({ id, title: id, titleZh: id })),
  blocks: ['frontmatter', 'abstract', 'introduction', 'results'].map((sectionId, index) => ({
    id: `block-${index}`, sectionId, kind: 'paragraph', en: `<p>${sectionId}</p>`, zh: `<p>${sectionId}译文</p>`,
  })),
  source: { url: entry.sourceUrl, htmlUrl: entry.sourceHtmlUrl, fetchedAt: '2026-10-11T00:00:00Z', sha256: 'a'.repeat(64) },
  translation: { status: 'machine' },
}
const preferences: ReaderPreferences = { mode: 'bilingual', swapped: false, synced: true, fontSize: 19, theme: 'light' }

let root: Root
let host: HTMLDivElement
let layoutScale: number
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
const observers = new Set<ResizeObserverCallback>()

function paneMetrics(pane: Element) {
  return pane.closest('.language-en')
    ? { tops: [0, 320, 920, 1720], total: 2920 }
    : { tops: [0, 240, 640, 1240], total: 2240 }
}

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  layoutScale = 1
  frames = new Map()
  nextFrame = 0
  observers.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.add(callback) }
    callback: ResizeObserverCallback
    observe() {}
    disconnect() { observers.delete(this.callback) }
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return 300 })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.matches('.pane-scroll') ? paneMetrics(this).total * layoutScale : 300
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const pane = this.closest<HTMLDivElement>('.pane-scroll')
    const blockId = this.dataset.blockId
    const top = pane && blockId
      ? 100 + paneMetrics(pane).tops[Number(blockId.split('-')[1])] * layoutScale - pane.scrollTop
      : 100
    return { x: 0, y: top, top, bottom: top + 100, left: 0, right: 500, width: 500, height: 100, toJSON() {} }
  })
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function flushFrames() {
  await act(() => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach(callback => callback(0))
  })
}

function pane(language: 'zh' | 'en') {
  return host.querySelector<HTMLDivElement>(`.language-${language} .pane-scroll`)!
}

async function scroll(language: 'zh' | 'en', top: number) {
  await act(() => {
    pane(language).scrollTop = top
    pane(language).dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await flushFrames()
}

describe('reading header folding', () => {
  it('keeps details accessible when expanded and preserves a manual expansion until the automatic state or paper changes', async () => {
    await act(() => root.render(<PaperHeader entry={entry} paper={paper} collapsed />))
    const details = host.querySelector<HTMLDivElement>('.paper-heading-details')!
    const button = host.querySelector<HTMLButtonElement>('button')!
    expect(details.getAttribute('aria-hidden')).toBe('true')
    expect(details.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('h1')?.textContent).toBe(paper.title)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe(details.id)
    await act(() => button.click())
    expect(details.getAttribute('aria-hidden')).toBe('false')
    expect(details.hasAttribute('inert')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('收起论文信息')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await act(() => root.render(<PaperHeader entry={entry} paper={paper} collapsed />))
    expect(details.getAttribute('aria-hidden')).toBe('false')
    await act(() => root.render(<PaperHeader entry={entry} paper={paper} collapsed={false} />))
    expect(details.getAttribute('aria-hidden')).toBe('false')
    expect(host.querySelector('button')).toBeNull()
    await act(() => root.render(<PaperHeader entry={entry} paper={paper} collapsed />))
    expect(details.getAttribute('aria-hidden')).toBe('true')
    await act(() => host.querySelector<HTMLButtonElement>('button')!.click())
    await act(() => root.render(<PaperHeader entry={{ ...entry, id: 'another-paper' }} paper={paper} collapsed />))
    expect(details.getAttribute('aria-hidden')).toBe('true')
  })

  it.each(['zh', 'en'] as const)('starts after front matter, then folds and unfolds from %s scrolling with a stable middle zone', async language => {
    const onPosition = vi.fn<(position: ReadingPosition) => void>()
    await act(() => root.render(<PaperReader paper={paper} entry={entry} preferences={preferences} onPosition={onPosition} />))
    expect(pane('zh').scrollTop).toBe(228)
    expect(pane('en').scrollTop).toBe(308)
    expect(onPosition.mock.lastCall?.[0]).toMatchObject({ sectionId: 'abstract', progress: 0, headerCollapsed: false })
    const abstractTop = paneMetrics(pane(language)).tops[1]
    await scroll(language, abstractTop + 100)
    expect(onPosition.mock.lastCall?.[0].headerCollapsed).toBe(true)
    await scroll(language, abstractTop + 40)
    expect(onPosition.mock.lastCall?.[0].headerCollapsed).toBe(true)
    await scroll(language, abstractTop - 12)
    expect(onPosition.mock.lastCall?.[0]).toMatchObject({ sectionId: 'abstract', headerCollapsed: false })
    await scroll(language, abstractTop + 40)
    expect(onPosition.mock.lastCall?.[0].headerCollapsed).toBe(false)
  })

  it('restores a saved deep reading position with the heading already folded', async () => {
    localStorage.setItem(`papero:reading:v1:${paper.id}`, JSON.stringify({ blockId: 'block-3', fraction: 0.25 }))
    const onPosition = vi.fn<(position: ReadingPosition) => void>()
    await act(() => root.render(<PaperReader paper={paper} entry={entry} preferences={preferences} onPosition={onPosition} />))
    expect(pane('zh').scrollTop).toBe(1478)
    expect(pane('en').scrollTop).toBe(2008)
    expect(onPosition.mock.lastCall?.[0]).toMatchObject({ sectionId: 'results', headerCollapsed: true })
  })

  it('keeps independent language anchors through the layout resize caused by folding when synchronization is off', async () => {
    const onPosition = vi.fn<(position: ReadingPosition) => void>()
    await act(() => root.render(<PaperReader paper={paper} entry={entry} preferences={{ ...preferences, synced: false }} onPosition={onPosition} />))
    await scroll('zh', 600)
    await scroll('en', 1800)
    layoutScale = 2
    await act(() => {
      for (const callback of observers) callback([], {} as ResizeObserver)
    })
    await flushFrames()
    expect(pane('zh').scrollTop).toBeCloseTo(1212)
    expect(pane('en').scrollTop).toBeCloseTo(3612)
    expect(onPosition.mock.lastCall?.[0]).toMatchObject({ sectionId: 'results', headerCollapsed: true })
  })
})
