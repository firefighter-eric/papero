import { Database, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CatalogPaper } from '../types'
import { PaperTags } from './PaperTags'
import { matchesPaperFilters, PAPER_FAMILIES, RESEARCH_TAGS, tagLabel } from '../lib/paper-tags'
import { useNavigationDrawer } from '../hooks/useNavigationDrawer'
import { shortPaperAuthors } from '../lib/paper-bibliography'

interface Props {
  papers: CatalogPaper[]
  selectedId?: string
  mobile: boolean
  open: boolean
  collapsed: boolean
  remoteData: boolean
  loading: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onToggle: () => void
}

export function Sidebar({ papers, selectedId, mobile, open, collapsed, remoteData, loading, onClose, onSelect, onToggle }: Props) {
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState('')
  const [research, setResearch] = useState('')
  const [sort, setSort] = useState('catalog')
  const drawer = useNavigationDrawer(mobile && open, onClose)
  const visible = mobile ? open : !collapsed
  const list = useRef<HTMLElement>(null)
  const listPosition = useRef(0)
  useLayoutEffect(() => {
    if (visible && list.current) list.current.scrollTop = listPosition.current
  }, [visible])
  const filtered = !!(query.trim() || family || research)
  const matches = useMemo(() => {
    const result = papers.filter(paper => matchesPaperFilters(paper, query, family, research))
    if (sort === 'year') result.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
    if (sort === 'title') result.sort((a, b) => a.title.localeCompare(b.title))
    return result
  }, [papers, query, family, research, sort])
  const families = PAPER_FAMILIES.filter(tag => papers.some(paper => paper.tags.includes(tag)))
  const researchTypes = RESEARCH_TAGS.filter(tag => papers.some(paper => paper.tags.includes(tag)))

  return <>
    {mobile && open && <button className="sidebar-backdrop" aria-label="关闭论文库" onClick={onClose} tabIndex={-1} />}
    <aside ref={drawer.ref} id="paper-sidebar" className={`sidebar library-sidebar${open ? ' is-open' : ''}${!mobile && collapsed ? ' is-collapsed' : ''}`}
      aria-label="论文检索" aria-hidden={mobile && !open ? true : undefined} inert={mobile && !open}
      role={mobile ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined} onKeyDown={drawer.onKeyDown}>
      <div className="brand-row">
        <div className="brand" hidden={!mobile && collapsed}><span className="brand-mark" aria-hidden="true" /><span className="brand-wordmark">papero</span></div>
        {mobile ? <button className="icon-button drawer-close" onClick={onClose} aria-label="关闭论文库"><X size={21} /></button>
          : <button className="icon-button library-toggle" onClick={onToggle} aria-label={collapsed ? '展开论文检索栏' : '折叠论文检索栏'}
            title={collapsed ? '展开论文检索栏' : '折叠论文检索栏'} aria-expanded={!collapsed} aria-controls="paper-library-content">
            {collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
          </button>}
      </div>
      <div id="paper-library-content" className="library-content" hidden={!visible}>
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
        <label className="library-sort"><span>排序</span><select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="catalog">默认顺序</option><option value="year">年份从新到旧</option><option value="title">标题 A–Z</option>
        </select></label>
        <nav ref={list} className="paper-list" aria-label="论文列表" onScroll={event => {
          if (visible) listPosition.current = event.currentTarget.scrollTop
        }}>
          {loading ? <p className="sidebar-hint">正在读取论文库…</p> : matches.map((paper) => <button key={paper.id}
            className={`paper-card ${paper.id === selectedId ? 'is-selected' : ''}`} aria-current={paper.id === selectedId ? 'page' : undefined}
            onClick={() => { onSelect(paper.id); if (mobile) onClose() }}>
            <span className="paper-card-title">{paper.title}</span>
            {paper.titleZh && <span className="paper-card-title-zh" lang="zh-CN">{paper.titleZh}</span>}
            <span className="paper-card-meta">{paper.arxivId === null && <>{paper.sourceKind === 'official-paper' ? '官方论文' : '官方文章'}<span aria-hidden="true"> · </span></>}
              {shortPaperAuthors(paper)}<span aria-hidden="true"> · </span>{paper.year}
              {paper.access === 'source-only' && <><span aria-hidden="true"> · </span>来源条目</>}</span>
            <PaperTags tags={paper.tags} compact />
          </button>)}
          {!loading && matches.length === 0 && <p className="sidebar-hint">{filtered ? '当前筛选下没有论文。' : '论文库暂无内容。'}</p>}
        </nav>
        <div className="data-status"><Database size={16} strokeWidth={1.4} aria-hidden="true" />
          <span>{remoteData ? '论文数据来自独立存储' : '论文数据来自本地'}</span>
        </div>
      </div>
    </aside>
  </>
}
