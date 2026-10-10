import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import type { CSSProperties, MouseEvent, UIEvent } from 'react'
import { sanitizePaperHtml } from '../lib/paper-data'
import { readSavedAnchor, saveAnchor } from '../hooks/reading-storage'
import type { ReadingAnchor } from '../hooks/reading-storage'
import type { ReaderPreferences } from '../hooks/usePreferences'
import type { FullTextCatalogPaper, PaperBlock, PaperDocument } from '../types'
import { ScrollRail } from './ScrollRail'

type Language = 'zh' | 'en'

export interface ReadingPosition {
  progress: number
  sectionId: string | null
}

export interface PaperReaderHandle {
  navigate: (sectionId: string) => void
}

interface Props {
  paper: PaperDocument
  entry: FullTextCatalogPaper
  preferences: ReaderPreferences
  onPosition: (position: ReadingPosition) => void
}

interface RenderedBlock extends PaperBlock {
  htmlZh: string
  htmlEn: string
}

/** Two language panes have distinct DOM IDs while keeping source anchors usable. */
function namespaceSourceIds(html: string, prefix: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
    element.dataset.sourceId = element.id
    element.id = `${prefix}-${element.id}`
  })
  template.content.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((element) => {
    const target = element.getAttribute('href')!.slice(1)
    let decoded = target
    try { decoded = decodeURIComponent(target) } catch { /* Preserve unusual source anchors. */ }
    element.dataset.paperTarget = decoded
    element.setAttribute('href', `#${prefix}-${target}`)
  })
  return template.innerHTML
}

const TOP_OFFSET = 12

function blockElements(pane: HTMLElement) {
  return Array.from(pane.querySelectorAll<HTMLElement>('[data-block-id]'))
}

function relativeTop(element: HTMLElement, pane: HTMLElement) {
  return element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop
}

/** Measure between neighboring blocks, including their margins. */
function blockExtent(elements: HTMLElement[], index: number, pane: HTMLElement) {
  const top = relativeTop(elements[index], pane)
  const nextTop = index + 1 < elements.length ? relativeTop(elements[index + 1], pane) : pane.scrollHeight
  return { top, height: Math.max(1, nextTop - top) }
}

function anchorAt(pane: HTMLElement): ReadingAnchor | null {
  const elements = blockElements(pane)
  if (!elements.length) return null
  const position = pane.scrollTop + TOP_OFFSET
  let index = 0
  for (let i = 1; i < elements.length; i++) {
    if (relativeTop(elements[i], pane) > position) break
    index = i
  }
  const { top, height } = blockExtent(elements, index, pane)
  return { blockId: elements[index].dataset.blockId!, fraction: Math.max(0, Math.min(1, (position - top) / height)) }
}

function scrollToAnchor(pane: HTMLElement, anchor: ReadingAnchor) {
  const elements = blockElements(pane)
  const index = elements.findIndex((element) => element.dataset.blockId === anchor.blockId)
  if (index < 0) return
  const { top, height } = blockExtent(elements, index, pane)
  pane.scrollTop = top + anchor.fraction * height - TOP_OFFSET
}

function getInitialAnchor(paper: PaperDocument): ReadingAnchor | null {
  const hash = window.location.hash.slice(1)
  if (hash) {
    let id = hash
    try { id = decodeURIComponent(hash) } catch { /* Invalid fragments fall back below. */ }
    const block = paper.blocks.find((item) => item.sectionId === id || item.id === id || item.sourceId === id)
    if (block) return { blockId: block.id, fraction: 0 }
  }
  const stored = readSavedAnchor(paper.id)
  if (stored && paper.blocks.some((block) => block.id === stored.blockId)) return stored
  // The complete front matter stays in the document and TOC; start actual reading at the abstract.
  const first = paper.blocks.find((block) => block.sectionId !== 'frontmatter') ?? paper.blocks[0]
  return first ? { blockId: first.id, fraction: 0 } : null
}

export const PaperReader = forwardRef<PaperReaderHandle, Props>(function PaperReader({ paper, entry, preferences, onPosition }, ref) {
  const panes = useRef<Partial<Record<Language, HTMLDivElement>>>({})
  const anchor = useRef<ReadingAnchor | null>(getInitialAnchor(paper))
  const paneAnchors = useRef<Partial<Record<Language, ReadingAnchor | null>>>({ zh: anchor.current, en: anchor.current })
  const activeLanguage = useRef<Language>(preferences.mode === 'en' ? 'en' : 'zh')
  const frame = useRef<number | null>(null)
  const ignoreScroll = useRef(new Map<HTMLElement, number>())
  const paneRefs = useMemo(() => {
    const bind = (language: Language) => (element: HTMLDivElement | null) => {
      if (element) panes.current[language] = element
      else {
        const oldPane = panes.current[language]
        if (oldPane) ignoreScroll.current.delete(oldPane)
        delete panes.current[language]
      }
    }
    return { zh: bind('zh'), en: bind('en') }
  }, [])
  const paneGetters = useMemo(() => ({
    zh: () => panes.current.zh ?? null,
    en: () => panes.current.en ?? null,
  }), [])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preferencesRef = useRef(preferences)
  const onPositionRef = useRef(onPosition)
  preferencesRef.current = preferences
  onPositionRef.current = onPosition

  const blocks: RenderedBlock[] = useMemo(() => paper.blocks.map((block) => ({
    ...block,
    htmlEn: namespaceSourceIds(sanitizePaperHtml(block.en, entry.dataPath), `${paper.id}-en`),
    htmlZh: namespaceSourceIds(sanitizePaperHtml(block.zh ?? block.en, entry.dataPath), `${paper.id}-zh`),
  })), [paper, entry.dataPath])

  const languages: Language[] = preferences.mode === 'bilingual'
    ? preferences.swapped ? ['en', 'zh'] : ['zh', 'en']
    : [preferences.mode]

  const updatePosition = useCallback((current: ReadingAnchor, pane?: HTMLElement) => {
    const block = paper.blocks.find((item) => item.id === current.blockId)
    if (!block) return
    const body = paper.blocks.filter((item) => item.sectionId !== 'frontmatter')
    const index = body.findIndex((item) => item.id === current.blockId)
    const atEnd = pane && pane.scrollHeight > pane.clientHeight && pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 2
    onPositionRef.current({
      progress: atEnd ? 100 : Math.max(0, Math.min(100, (index + current.fraction) / Math.max(1, body.length) * 100)),
      sectionId: block.sectionId,
    })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveAnchor(paper.id, current), 400)
  }, [paper])

  const place = useCallback((current: ReadingAnchor, target?: Language) => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    for (const [language, pane] of Object.entries(panes.current)) {
      if (!pane || (target && language !== target)) continue
      scrollToAnchor(pane, current)
      ignoreScroll.current.set(pane, pane.scrollTop)
      paneAnchors.current[language as Language] = current
    }
    anchor.current = current
    updatePosition(current, panes.current[target ?? activeLanguage.current])
  }, [updatePosition])

  const preservePanePositions = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    for (const [language, pane] of Object.entries(panes.current)) {
      const current = paneAnchors.current[language as Language] ?? anchor.current
      if (!pane || !current) continue
      scrollToAnchor(pane, current)
      ignoreScroll.current.set(pane, pane.scrollTop)
    }
    if (anchor.current) updatePosition(anchor.current, panes.current[activeLanguage.current])
  }, [updatePosition])

  const previousMode = useRef(preferences.mode)
  useLayoutEffect(() => {
    const modeChanged = previousMode.current !== preferences.mode
    previousMode.current = preferences.mode
    if (preferences.mode !== 'bilingual') activeLanguage.current = preferences.mode
    if (anchor.current && (preferences.synced || modeChanged)) place(anchor.current)
    else preservePanePositions()
  }, [preferences.mode, preferences.swapped, preferences.fontSize, preferences.synced, place, preservePanePositions])

  // Images and viewport changes can alter block heights after the initial render.
  useEffect(() => {
    let resizeFrame: number | null = null
    const observer = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        if (preferencesRef.current.synced && anchor.current) place(anchor.current)
        else preservePanePositions()
      })
    })
    for (const pane of Object.values(panes.current)) {
      if (pane) {
        observer.observe(pane)
        const content = pane.querySelector('.paper-content')
        if (content) observer.observe(content)
      }
    }
    return () => {
      observer.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    }
  }, [preferences.mode, preferences.swapped, place, preservePanePositions])

  useEffect(() => {
    const persist = () => saveAnchor(paper.id, anchor.current)
    const onVisibility = () => { if (document.visibilityState === 'hidden') persist() }
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      persist()
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', onVisibility)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [paper.id])

  const navigate = useCallback((sectionId: string) => {
    const block = paper.blocks.find((item) => item.sectionId === sectionId)
    if (!block) return
    place({ blockId: block.id, fraction: 0 })
    const url = new URL(window.location.href)
    url.hash = sectionId
    history.replaceState(null, '', url)
    const pane = panes.current[activeLanguage.current] ?? Object.values(panes.current)[0]
    pane?.focus({ preventScroll: true })
  }, [paper.blocks, place])

  useImperativeHandle(ref, () => ({ navigate }), [navigate])

  function onScroll(event: UIEvent<HTMLDivElement>, language: Language) {
    const source = event.currentTarget
    const expected = ignoreScroll.current.get(source)
    if (expected !== undefined) {
      ignoreScroll.current.delete(source)
      if (Math.abs(source.scrollTop - expected) < 1) return
    }
    // A TOC deep link should not override a later, more precise saved reading position.
    if (window.location.hash) {
      const url = new URL(window.location.href)
      url.hash = ''
      history.replaceState(null, '', url)
    }
    activeLanguage.current = language
    // Capture before another input, resize, or mode switch can change this pane's geometry.
    const current = anchorAt(source)
    if (!current) return
    anchor.current = current
    paneAnchors.current[language] = current
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (!source.isConnected || panes.current[language] !== source) return
      updatePosition(current, source)
      if (preferencesRef.current.mode === 'bilingual' && preferencesRef.current.synced) {
        const other = panes.current[language === 'zh' ? 'en' : 'zh']
        if (other) {
          scrollToAnchor(other, current)
          ignoreScroll.current.set(other, other.scrollTop)
          paneAnchors.current[language === 'zh' ? 'en' : 'zh'] = current
        }
      }
    })
  }

  function onSourceLink(event: MouseEvent<HTMLDivElement>, language: Language) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-paper-target]') : null
    const id = link?.dataset.paperTarget
    const pane = panes.current[language]
    if (!id || !pane) return
    const target = Array.from(pane.querySelectorAll<HTMLElement>('[data-source-id]')).find((element) => element.dataset.sourceId === id)
    const containingBlock = target?.closest<HTMLElement>('[data-block-id]')
    if (target && containingBlock) {
      event.preventDefault()
      const elements = blockElements(pane)
      const index = elements.indexOf(containingBlock)
      const extent = blockExtent(elements, index, pane)
      const current = {
        blockId: containingBlock.dataset.blockId!,
        fraction: Math.max(0, Math.min(1, (relativeTop(target, pane) - extent.top) / extent.height)),
      }
      activeLanguage.current = language
      place(current, preferencesRef.current.synced ? undefined : language)
      const url = new URL(window.location.href)
      url.hash = id
      history.replaceState(null, '', url)
      target.focus?.({ preventScroll: true })
    } else if (paper.sections.some((section) => section.id === id)) {
      event.preventDefault()
      navigate(id)
    }
  }

  const missingTranslation = paper.blocks.some((block) => block.zh === null)
  return <div className={`reader-panes ${preferences.mode === 'bilingual' ? 'is-bilingual' : 'is-single'}`} style={{ '--reader-font-size': `${preferences.fontSize}px` } as CSSProperties}>
    {languages.map((language) => <section className={`reader-pane language-${language}`} key={language} aria-label={language === 'zh' ? '中文译文' : '英文原文'}>
      <div className="pane-label"><span className={`language-dot ${language}`} aria-hidden="true" />
        <span>{language === 'zh' ? '中文译文' : 'English original'}</span>
        {language === 'zh' && missingTranslation && <span className="pane-translation-status">部分译文待生成</span>}
      </div>
      <div className="pane-body">
      <div className="pane-scroll" id={`pane-${paper.id}-${language}`} ref={paneRefs[language]}
        tabIndex={0} aria-label={language === 'zh' ? '中文论文正文，可滚动阅读' : 'English paper, scroll to read'}
        onScroll={(event) => onScroll(event, language)} onClick={(event) => onSourceLink(event, language)}>
        <article className="paper-content" lang={language === 'zh' ? 'zh-CN' : 'en'}>
          {blocks.map((block) => <div key={block.id} data-block-id={block.id} data-source-id={block.sourceId}
            data-section-id={block.sectionId} className={`paper-block block-${block.kind} ${language === 'zh' && block.zh === null ? 'translation-pending' : ''}`}>
            {language === 'zh' && block.zh === null && block.kind !== 'heading' && <span className="pending-label">译文待生成 · 英文原文</span>}
            <div className="block-html" lang={language === 'zh' && block.zh === null ? 'en' : undefined}
              tabIndex={block.kind === 'code' ? 0 : undefined}
              aria-label={block.kind === 'code' ? language === 'zh' ? '代码示例，保留原文' : 'Source code example' : undefined}
              dangerouslySetInnerHTML={{ __html: language === 'zh' ? block.htmlZh : block.htmlEn }} />
          </div>)}
        </article>
      </div>
      <ScrollRail getPane={paneGetters[language]} controls={`pane-${paper.id}-${language}`} label={language === 'zh' ? '中文滚动条' : '英文滚动条'} />
      </div>
    </section>)}
  </div>
})
