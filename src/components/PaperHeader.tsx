import type { CatalogPaper, PaperDocument } from '../types'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import { PaperTags } from './PaperTags'
import { paperAuthors } from '../lib/paper-bibliography'

export function PaperHeader({ entry, paper, collapseProgress = 0 }: { entry: CatalogPaper; paper: PaperDocument | null; collapseProgress?: number }) {
  const [expanded, setExpanded] = useState(false)
  const [animateToggle, setAnimateToggle] = useState(false)
  const heading = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const detailsId = useId()
  const hasScroll = collapseProgress > 0
  const progress = expanded ? 0 : Math.max(0, Math.min(1, collapseProgress))
  const compact = progress === 1
  useEffect(() => { setExpanded(false) }, [entry.id, hasScroll])
  useLayoutEffect(() => { setAnimateToggle(false) }, [collapseProgress])
  useLayoutEffect(() => {
    const content = body.current
    const header = heading.current
    if (!content || !header) return
    const measure = () => header.style.setProperty('--heading-body-height', `${content.getBoundingClientRect().height}px`)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])
  const title = paper?.title || entry.title
  const titleZh = paper?.titleZh || entry.titleZh
  const authors = paperAuthors(paper || entry)
  const authorNames = authors.join(', ')
  const manyAuthors = authors.length > 12 || authorNames.length > 230
  const translated = paper?.blocks.filter((block) => block.zh !== null).length ?? 0
  const total = paper?.blocks.length ?? entry.blockCount
  const complete = paper ? translated === total : entry.translationStatus === 'machine'
  return <header ref={heading} className={`paper-heading${compact ? ' is-compact' : ''}${progress > 0 ? ' is-collapsing' : ''}${animateToggle ? '' : ' is-scroll-driven'}`}
    style={{ '--heading-collapse': progress } as CSSProperties}>
    <span className="paper-heading-compact-title" aria-hidden="true" title={title}>{title}</span>
    <div className="paper-heading-body"><div ref={body} className="paper-heading-body-inner">
    <h1 title={compact ? title : undefined}>{title}</h1>
    <div id={detailsId} className="paper-heading-details" aria-hidden={progress > 0} inert={progress > 0}>
    {titleZh && <p className="paper-title-zh" lang="zh-CN">{titleZh}</p>}
    {manyAuthors ? <div className="paper-authors paper-authors-expandable">
      <p className="author-preview" lang="en">{authorNames}</p>
      <details className="author-disclosure" key={entry.id} onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.open = false
      }}>
        <summary>{authors.length > 1 ? `查看全部署名（${authors.length}）` : '查看完整署名'}<ChevronDown size={12} aria-hidden="true" /></summary>
        <div className="author-full-list" tabIndex={0} aria-label="完整署名名单"><p lang="en">{authorNames}</p></div>
      </details>
    </div> : <p className="paper-authors" lang="en">{authorNames}</p>}
    <p className="paper-metadata"><span>{paper?.year || entry.year}</span><span aria-hidden="true">·</span>
      <span>{entry.sourceKind === 'official-paper' ? '官方论文' : entry.arxivId === null ? '官方文章' : `arXiv:${entry.arxivId}`}</span><span aria-hidden="true">·</span>
      <span>{entry.access === 'source-only' ? '来源条目' : complete ? '机器翻译' : translated > 0 ? `机器翻译 · ${Math.round(translated / Math.max(1, total) * 100)}% 已完成` : '中文翻译待生成'}</span>
    </p>
    <PaperTags tags={entry.tags} />
    </div>
    </div></div>
    {hasScroll && <button className="paper-heading-toggle" onClick={() => { setAnimateToggle(true); setExpanded((value) => !value) }}
      aria-expanded={expanded} aria-controls={detailsId} aria-label={expanded ? '收起论文信息' : '展开论文信息'}
      title={expanded ? '收起论文信息' : '展开论文信息'}>
      <ChevronDown size={18} aria-hidden="true" />
    </button>}
  </header>
}
