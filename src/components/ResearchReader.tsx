import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { ReadingPosition } from './PaperReader'
import type { ResearchDocument } from '../types'
import { createResearchVisualRuntime } from '../lib/research-visuals.mjs'
import '../lib/research-visuals.css'

const visuals = createResearchVisualRuntime()

export const ResearchReader = forwardRef<{ navigate: (id: string) => void }, {
  report: ResearchDocument & { html: string }
  fontSize: number
  onPosition: (position: ReadingPosition) => void
}>(({ report, fontSize, onPosition }, ref) => {
  const pane = useRef<HTMLDivElement>(null)
  const article = useRef<HTMLElement>(null)
  useEffect(() => {
    if (article.current) return visuals.mount(article.current)
  }, [report.html])
  const storageKey = `papero:research-position:${report.id}:r${report.revision}:v1`
  const navigate = useCallback((id: string) => {
    const node = pane.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
    if (!node || !pane.current) return
    pane.current.scrollTop += node.getBoundingClientRect().top - pane.current.getBoundingClientRect().top - 28
    const url = new URL(window.location.href); url.hash = id; history.replaceState(null, '', url)
  }, [])
  useImperativeHandle(ref, () => ({ navigate }), [navigate])
  const update = useCallback(() => {
    if (!pane.current) return
    const el = pane.current
    const top = el.getBoundingClientRect().top
    const current = report.sections.filter(s => {
      const heading = el.querySelector<HTMLElement>(`[id="${s.id}"]`)
      return heading && heading.getBoundingClientRect().top <= top + 80
    }).at(-1)?.id ?? report.sections[0]?.id ?? null
    onPosition({ progress: el.scrollHeight <= el.clientHeight ? 100 : el.scrollTop / (el.scrollHeight - el.clientHeight) * 100,
      sectionId: current, headerCollapseProgress: 0 })
  }, [onPosition, report])
  useEffect(() => {
    const el = pane.current
    if (!el) return
    let hash = ''
    try { hash = decodeURIComponent(window.location.hash.slice(1)) } catch { /* Ignore malformed external fragments. */ }
    if (hash) navigate(hash)
    else { try { el.scrollTop = Number(localStorage.getItem(storageKey)) || 0 } catch { /* Optional reading position. */ } }
    update()
    const save = () => { try { localStorage.setItem(storageKey, String(el.scrollTop)) } catch { /* Optional reading position. */ } }
    el.addEventListener('scrollend', save)
    const observer = new ResizeObserver(update); observer.observe(el)
    return () => { save(); el.removeEventListener('scrollend', save); observer.disconnect() }
  }, [navigate, storageKey, update])
  useEffect(update, [fontSize, update])
  return <div className="research-reader" ref={pane} onScroll={update} aria-label="中文研究报告正文" tabIndex={0}>
    <article ref={article} className="research-prose paper-block" lang="zh-CN" style={{ fontSize }}
      onClick={event => {
        const link = (event.target as Element).closest('a[href^="#"]')
        if (link) { event.preventDefault(); navigate(link.getAttribute('href')!.slice(1)) }
      }} dangerouslySetInnerHTML={{ __html: report.html }} />
  </div>
})
