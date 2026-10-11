import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarResizeHandle } from '../src/components/SidebarResizeHandle'
import { SIDEBAR_WIDTH_DEFAULTS, SIDEBAR_WIDTH_LIMITS, useSidebarWidths } from '../src/hooks/useSidebarWidths'

const KEY = 'papero:sidebar-widths:v1'
let root: Root
let host: HTMLDivElement
let containerWidth: number
const observers = new Set<ResizeObserverCallback>()

beforeEach(() => {
  localStorage.clear()
  containerWidth = 1600
  observers.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.add(callback) }
    callback: ResizeObserverCallback
    observe() {}
    disconnect() { observers.delete(this.callback) }
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => containerWidth)
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Layout({ collapsed = false, mobile = false }: { collapsed?: boolean; mobile?: boolean }) {
  const shell = useRef<HTMLDivElement>(null)
  const widths = useSidebarWidths(shell, collapsed)
  return <div ref={shell}>
    <output data-library={widths.library} data-toc={widths.toc} />
    {(['library', 'toc'] as const).map(panel => mobile || (panel === 'library' && collapsed) ? null
      : <SidebarResizeHandle key={panel} label={panel} controls={`panel-${panel}`} value={widths[panel]}
        min={SIDEBAR_WIDTH_LIMITS[panel].min} max={widths[panel === 'library' ? 'libraryMax' : 'tocMax']}
        defaultValue={SIDEBAR_WIDTH_DEFAULTS[panel]} onChange={value => widths.setWidth(panel, value)} />)}
  </div>
}

function handle(panel: 'library' | 'toc') {
  return host.querySelector<HTMLDivElement>(`[role="separator"][aria-label="${panel}"]`)!
}

function widths() {
  const output = host.querySelector('output')!
  return { library: Number(output.dataset.library), toc: Number(output.dataset.toc) }
}

async function key(panel: 'library' | 'toc', key: string, shiftKey = false) {
  await act(() => handle(panel).dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })))
}

async function pointer(panel: 'library' | 'toc', type: string, x: number, pointerType = 'mouse', pointerId = 1) {
  const element = handle(panel)
  if (!element.setPointerCapture) {
    element.setPointerCapture = vi.fn()
    element.hasPointerCapture = vi.fn(() => true)
    element.releasePointerCapture = vi.fn()
  }
  const event = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true })
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: pointerType } })
  await act(() => element.dispatchEvent(event))
}

async function resize(width: number) {
  containerWidth = width
  await act(() => {
    for (const callback of observers) callback([], {} as ResizeObserver)
    window.dispatchEvent(new Event('resize'))
  })
}

describe('independent sidebar widths', () => {
  it.each(['mouse', 'touch'])('drags either boundary independently using %s pointer capture and stops on release', async pointerType => {
    await act(() => root.render(<Layout />))
    await pointer('library', 'pointerdown', 300, pointerType)
    expect(document.activeElement).toBe(handle('library'))
    expect(handle('library').setPointerCapture).toHaveBeenCalledWith(1)
    await pointer('library', 'pointermove', 360, pointerType)
    expect(widths()).toEqual({ library: 360, toc: 220 })
    expect(handle('library').getAttribute('aria-valuenow')).toBe('360')
    await pointer('library', 'pointerup', 360, pointerType)
    await pointer('library', 'pointermove', 400, pointerType)
    expect(widths()).toEqual({ library: 360, toc: 220 })
    await pointer('toc', 'pointerdown', 580, pointerType)
    await pointer('toc', 'pointermove', 630, pointerType)
    expect(widths()).toEqual({ library: 360, toc: 270 })
    await pointer('toc', 'pointercancel', 630, pointerType)
    expect(handle('toc').classList.contains('is-dragging')).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ library: 360, toc: 270 })
  })

  it('supports keyboard increments, accelerated adjustment, limits, and two ways to restore the default', async () => {
    await act(() => root.render(<Layout />))
    await key('library', 'ArrowRight')
    await key('library', 'ArrowRight', true)
    expect(widths()).toEqual({ library: 350, toc: 220 })
    await key('toc', 'ArrowLeft', true)
    expect(widths()).toEqual({ library: 350, toc: 180 })
    await key('toc', 'ArrowLeft', true)
    expect(widths().toc).toBe(160)
    await key('library', 'End')
    expect(widths().library).toBe(460)
    await key('library', 'ArrowRight')
    expect(widths().library).toBe(460)
    await key('library', 'Home')
    expect(widths().library).toBe(300)
    await act(() => handle('toc').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(widths()).toEqual(SIDEBAR_WIDTH_DEFAULTS)
    expect(handle('toc').getAttribute('aria-controls')).toBe('panel-toc')
    expect(handle('toc').getAttribute('aria-orientation')).toBe('vertical')
    expect(handle('toc').getAttribute('aria-valuetext')).toBe('220 像素')
  })

  it('restores both saved widths after remounting and keeps the library preference while collapsed', async () => {
    await act(() => root.render(<Layout />))
    await key('library', 'ArrowRight', true)
    await key('toc', 'ArrowRight', true)
    await act(() => root.render(null))
    await act(() => root.render(<Layout collapsed />))
    expect(handle('library')).toBeNull()
    expect(widths()).toEqual({ library: 48, toc: 260 })
    await key('toc', 'ArrowRight')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ library: 340, toc: 270 })
    await act(() => root.render(<Layout />))
    expect(widths()).toEqual({ library: 340, toc: 270 })
  })

  it('temporarily fits oversized saved widths to narrow screens and restores them after mobile and desktop transitions', async () => {
    localStorage.setItem(KEY, JSON.stringify({ library: 460, toc: 400 }))
    await act(() => root.render(<Layout />))
    expect(widths()).toEqual({ library: 460, toc: 400 })
    await resize(761)
    expect(widths().library).toBeGreaterThanOrEqual(220)
    expect(widths().toc).toBeGreaterThanOrEqual(160)
    expect(761 - widths().library - widths().toc).toBeGreaterThanOrEqual(320)
    expect(handle('toc').getAttribute('aria-valuemax')).toBe(String(widths().toc))
    await resize(390)
    await act(() => root.render(<Layout mobile />))
    expect(host.querySelector('[role="separator"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ library: 460, toc: 400 })
    await resize(1600)
    await act(() => root.render(<Layout />))
    expect(widths()).toEqual({ library: 460, toc: 400 })
  })

  it('keeps the other visible panel steady when resizing a temporarily constrained layout', async () => {
    localStorage.setItem(KEY, JSON.stringify({ library: 460, toc: 400 }))
    containerWidth = 761
    await act(() => root.render(<Layout />))
    const initial = widths()
    await key('toc', 'ArrowLeft')
    expect(widths()).toEqual({ library: initial.library, toc: initial.toc - 10 })
    await key('library', 'ArrowRight')
    expect(widths()).toEqual({ library: initial.library + 10, toc: initial.toc - 10 })
    expect(761 - widths().library - widths().toc).toBeGreaterThanOrEqual(320)
  })

  it('ignores corrupt settings and invalid values without preventing resizing when storage is blocked', async () => {
    localStorage.setItem(KEY, JSON.stringify({ library: 'huge', toc: 9000 }))
    await act(() => root.render(<Layout />))
    expect(widths()).toEqual({ library: 300, toc: 400 })
    await act(() => root.render(null))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable') })
    await act(() => root.render(<Layout />))
    await key('library', 'ArrowRight')
    expect(widths()).toEqual({ library: 310, toc: 220 })
  })

  it('cleans up observers and ends a drag after pointer capture is lost', async () => {
    await act(() => root.render(<Layout />))
    expect(observers.size).toBe(1)
    await pointer('toc', 'pointerdown', 520)
    await pointer('toc', 'lostpointercapture', 530)
    await pointer('toc', 'pointermove', 560)
    expect(widths().toc).toBe(220)
    expect(handle('toc').classList.contains('is-dragging')).toBe(false)
    await act(() => root.render(null))
    expect(observers.size).toBe(0)
  })
})
