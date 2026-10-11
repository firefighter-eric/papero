import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export type SidebarPanel = 'library' | 'toc'
export interface SidebarWidths { library: number; toc: number }

export const SIDEBAR_WIDTH_DEFAULTS: SidebarWidths = { library: 300, toc: 220 }
export const SIDEBAR_WIDTH_LIMITS = { library: { min: 220, max: 460 }, toc: { min: 160, max: 400 } }
const KEY = 'papero:sidebar-widths:v1'
const COLLAPSED_WIDTH = 48
const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)))

function initialWidths(): SidebarWidths {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!saved || typeof saved !== 'object') return SIDEBAR_WIDTH_DEFAULTS
    const widths = saved as Partial<SidebarWidths>
    const read = (panel: SidebarPanel) => {
      const value = widths[panel]
      const { min, max } = SIDEBAR_WIDTH_LIMITS[panel]
      return typeof value === 'number' && Number.isFinite(value)
        ? clamp(value, min, max) : SIDEBAR_WIDTH_DEFAULTS[panel]
    }
    return { library: read('library'), toc: read('toc') }
  } catch { return SIDEBAR_WIDTH_DEFAULTS }
}

/** Fit saved desktop widths to the available space without overwriting them on a viewport change. */
export function fitSidebarWidths(preferred: SidebarWidths, containerWidth: number, collapsed: boolean) {
  const width = Math.max(SIDEBAR_WIDTH_LIMITS.library.min + SIDEBAR_WIDTH_LIMITS.toc.min + 320, containerWidth)
  const readerMinimum = Math.min(480, Math.max(320, Math.round(width * 0.42)))
  const budget = width - readerMinimum
  const libraryMinimum = collapsed ? COLLAPSED_WIDTH : SIDEBAR_WIDTH_LIMITS.library.min
  const toc = clamp(preferred.toc, SIDEBAR_WIDTH_LIMITS.toc.min, Math.min(SIDEBAR_WIDTH_LIMITS.toc.max, budget - libraryMinimum))
  const library = collapsed ? COLLAPSED_WIDTH
    : clamp(preferred.library, SIDEBAR_WIDTH_LIMITS.library.min, Math.min(SIDEBAR_WIDTH_LIMITS.library.max, budget - toc))
  return {
    library, toc,
    libraryMax: Math.floor(Math.min(SIDEBAR_WIDTH_LIMITS.library.max, budget - toc)),
    tocMax: Math.floor(Math.min(SIDEBAR_WIDTH_LIMITS.toc.max, budget - library)),
  }
}

export function useSidebarWidths(container: RefObject<HTMLDivElement | null>, collapsed: boolean) {
  const [preferred, setPreferred] = useState(initialWidths)
  const [containerWidth, setContainerWidth] = useState(() => Math.min(2200, window.innerWidth) - 2)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const measure = () => {
      const width = element.clientWidth || Math.min(2200, window.innerWidth) - 2
      setContainerWidth(previous => previous === width ? previous : width)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [container])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(preferred)) } catch { /* Resizing also works without storage. */ }
  }, [preferred])

  const setWidth = useCallback((panel: SidebarPanel, value: number) => {
    if (!Number.isFinite(value)) return
    setPreferred(previous => {
      const current = fitSidebarWidths(previous, containerWidth, collapsed)
      const next = {
        // An explicit resize holds the other visible panel steady; folding keeps its saved expanded width.
        library: collapsed ? previous.library : current.library,
        toc: current.toc,
        [panel]: clamp(value, SIDEBAR_WIDTH_LIMITS[panel].min, current[panel === 'library' ? 'libraryMax' : 'tocMax']),
      }
      return next.library === previous.library && next.toc === previous.toc ? previous : next
    })
  }, [containerWidth, collapsed])

  return { ...fitSidebarWidths(preferred, containerWidth, collapsed), setWidth }
}
