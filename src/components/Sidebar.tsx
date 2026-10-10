import { BookOpen, Database, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CatalogPaper, PaperSection } from '../types'
import { PaperTags } from './PaperTags'
import { matchesPaperFilters, PAPER_FAMILIES, RESEARCH_TAGS, tagLabel } from '../lib/paper-tags'

interface Props {
  papers: CatalogPaper[]
  selectedId?: string
  sections: PaperSection[]
  activeSection: string | null
  mobile: boolean
  open: boolean
  remoteData: boolean
  loading: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onNavigate: (id: string) => void
}

export function Sidebar({ papers, selectedId, sections, activeSection, mobile, open, remoteData, loading, onClose, onSelect, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState('')
  const [research, setResearch] = useState('')
  const aside = useRef<HTMLElement>(null)
  const filtered = !!(query.trim() || family || research)
  const sourceOnlySelected = papers.find((paper) => paper.id === selectedId)?.access === 'source-only'
  const matches = papers.filter(paper => matchesPaperFilters(paper, query, family, research))
  const families = PAPER_FAMILIES.filter(tag => papers.some(paper => paper.tags.includes(tag)))
  const researchTypes = RESEARCH_TAGS.filter(tag => papers.some(paper => paper.tags.includes(tag)))

  useEffect(() => {
    if (!mobile || !open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    aside.current?.querySelector<HTMLElement>('button')?.focus()
    return () => { previous?.focus() }
  }, [mobile, open])

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!mobile || !open) return
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const focusable = Array.from(aside.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href]') ?? [])
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return <>
    {mobile && open && <button className="sidebar-backdrop" aria-label="关闭论文库" onClick={onClose} tabIndex={-1} />}
    <aside ref={aside} id="paper-sidebar" className={`sidebar ${open ? 'is-open' : ''}`}
      aria-label="论文库与本文目录" aria-hidden={mobile && !open ? true : undefined}
      role={mobile ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined} onKeyDown={onKeyDown}>
      <div className="brand-row">
        <div className="brand"><BookOpen size={34} strokeWidth={1.5} aria-hidden="true" /><span>papero</span></div>
        {mobile && <button className="icon-button drawer-close" onClick={onClose} aria-label="关闭论文库"><X size={21} /></button>}
      </div>
      <p className="brand-caption">论文阅读，让理解更近一步</p>
      <label className="library-search"><Search size={18} aria-hidden="true" /><span className="sr-only">搜索论文标题、作者或关键词</span>
        <input type="search" placeholder="搜索论文…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="library-filters" role="group" aria-label="论文标签筛选">
        <label><span>模型系列</span><select value={family} onChange={event => setFamily(event.target.value)}>
          <option value="">全部系列</option>
          {families.map(tag => <option key={tag} value={tag}>{tagLabel(tag)}</option>)}
        </select></label>
        <label><span>研究阶段</span><select value={research} onChange={event => setResearch(event.target.value)}>
          <option value="">全部类型</option>
          {researchTypes.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select></label>
      </div>
      <div className="sidebar-section-title"><h2>论文库</h2><div className="library-results">
        {filtered && <button className="filter-reset" onClick={() => { setQuery(''); setFamily(''); setResearch('') }} aria-label="清除论文筛选">重置</button>}
        <span aria-live="polite" aria-atomic="true">{filtered ? `${matches.length} / ${papers.length}` : papers.length}</span>
      </div></div>
      <nav className="paper-list" aria-label="论文列表">
        {loading ? <p className="sidebar-hint">正在读取论文库…</p> : matches.map((paper) => <button key={paper.id}
          className={`paper-card ${paper.id === selectedId ? 'is-selected' : ''}`} aria-current={paper.id === selectedId ? 'page' : undefined}
          onClick={() => { onSelect(paper.id); if (mobile) onClose() }}>
          <span className="paper-card-title">{paper.title}</span>
          <span className="paper-card-meta">{paper.arxivId === null && <>官方文章<span aria-hidden="true"> · </span></>}
            {paper.authors[0]?.split(' ').at(-1) || (paper.arxivId === null ? '官方来源' : 'arXiv')}{paper.authors.length > 1 ? ' et al.' : ''}<span aria-hidden="true"> · </span>{paper.year}
            {paper.access === 'source-only' && <><span aria-hidden="true"> · </span>来源条目</>}</span>
          <PaperTags tags={paper.tags} compact />
        </button>)}
        {!loading && matches.length === 0 && <p className="sidebar-hint">{filtered ? '当前筛选下没有论文。' : '论文库暂无内容。'}</p>}
      </nav>
      <div className="toc-area">
        <div className="sidebar-section-title"><h2>本文目录</h2></div>
        <nav className="toc" aria-label="本文目录">
          {sections.map((section) => <button key={section.id} title={section.title}
            style={{ paddingLeft: `${18 + Math.max(0, (section.level ?? 1) - 1) * 14}px` }}
            className={`toc-link ${section.id === activeSection ? 'is-active' : ''}`}
            aria-current={section.id === activeSection ? 'location' : undefined}
            onClick={() => { onNavigate(section.id); if (mobile) onClose() }}>
            {section.titleZh || section.title}
          </button>)}
          {sections.length === 0 && <p className="sidebar-hint">{sourceOnlySelected ? '全文保留在本地，本站展示来源信息。' : '选择论文后显示目录。'}</p>}
        </nav>
      </div>
      <div className="data-status"><Database size={16} strokeWidth={1.4} aria-hidden="true" />
        <span>{remoteData ? '论文数据来自独立存储' : '论文数据来自本地'}</span>
      </div>
    </aside>
  </>
}
