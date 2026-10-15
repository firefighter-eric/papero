import { ArrowLeft, ArrowUpRight, BookOpen, Search } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { CatalogPaper, ResearchEntry } from '../types'
import type { ReaderPreferences } from '../hooks/usePreferences'
import { PAPER_CATEGORIES, browseHref, matchesPaperCategory } from '../lib/paper-categories'
import { matchesPaperFilters, PAPER_FAMILIES, tagLabel } from '../lib/paper-tags'
import { shortPaperAuthors } from '../lib/paper-bibliography'
import { AppLink } from './AppLink'
import { PaperTags } from './PaperTags'
import { ThemeControl } from './ThemeControl'

interface Props {
  papers: CatalogPaper[]
  reports: ResearchEntry[]
  params: URLSearchParams
  theme: ReaderPreferences['theme']
  onTheme: (theme: ReaderPreferences['theme']) => void
  onNavigate: (href: string, replace?: boolean) => void
  onPaper: (id: string) => void
  scrollPositions: Map<string, number>
  children?: ReactNode
}

export function LibraryHome({ papers, reports, params, theme, onTheme, onNavigate, onPaper, scrollPositions, children }: Props) {
  const category = params.get('category') ?? ''
  const current = PAPER_CATEGORIES.find(item => item.id === category)
  const family = params.get('family') ?? ''
  const query = params.get('q') ?? ''
  const sort = params.get('sort') ?? 'catalog'
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    element.scrollTop = scrollPositions.get(category) ?? 0
    const switcher = element.querySelector<HTMLElement>('.category-switcher')
    const selected = switcher?.querySelector<HTMLElement>('[aria-current="page"]')
    if (switcher && selected) switcher.scrollLeft = selected.offsetLeft - switcher.offsetLeft - (switcher.clientWidth - selected.clientWidth) / 2
    return () => { scrollPositions.set(category, element.scrollTop) }
  }, [category, scrollPositions])
  const filtered = Boolean(category || family || query.trim())
  const matches = useMemo(() => {
    const result = papers.filter(paper => matchesPaperCategory(paper, category) && matchesPaperFilters(paper, query, family, ''))
    if (sort === 'year') result.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
    if (sort === 'oldest') result.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title))
    if (sort === 'title') result.sort((a, b) => a.title.localeCompare(b.title))
    return result
  }, [papers, category, query, family, sort])
  const categories = PAPER_CATEGORIES.map(item => ({ ...item, count: papers.filter(paper => matchesPaperCategory(paper, item.id)).length })).filter(item => item.count > 0)
  const families = PAPER_FAMILIES.filter(tag => papers.some(paper => paper.tags.includes(tag)))
  const update = (patch: Record<string, string | null>, replace = false) => onNavigate(browseHref(params, patch), replace)
  const showHome = () => {
    scrollPositions.set('', 0)
    if (container.current) container.current.scrollTop = 0
    onNavigate('/')
  }

  return <div className={`library-home${current ? ' is-category' : ''}`} ref={container}>
    <header className="home-header">
      <AppLink href="/" onNavigate={showHome} className="brand" aria-label="Papero 分类主页"><span className="brand-mark" aria-hidden="true" /><span className="brand-wordmark">papero</span></AppLink>
      <nav aria-label="主页导航"><a href="#home-papers">论文库 <span>{papers.length}</span></a>{reports.length > 0 && <a href="#home-research">研究产出 <span>{reports.length}</span></a>}</nav>
      <ThemeControl theme={theme} onChange={onTheme} />
    </header>
    <main className="home-main">
      <section className="home-intro" aria-labelledby="home-title">
        {current ? <AppLink href="/" onNavigate={showHome} className="home-eyebrow home-reset"><ArrowLeft size={15} aria-hidden="true" />返回分类主页</AppLink> : <p className="home-eyebrow">论文阅读，让理解更近一步</p>}
        <h1 id="home-title">{current?.title ?? '从一个方向，读进 AI。'}</h1>
        <p>{current?.description ?? '按主题寻找论文，在中英对照中理解原文。'}</p>
        <label className="home-search"><Search size={21} aria-hidden="true" /><span className="sr-only">搜索论文标题、作者或关键词</span>
          <input type="search" placeholder="搜索论文、作者、模型或关键词…" value={query} onChange={event => update({ q: event.target.value || null }, true)} />
          {query && <button onClick={() => update({ q: null }, true)} aria-label="清除主页搜索">清除</button>}
        </label>
      </section>
      {children ?? <>
        {!current && !query.trim() && <section className="home-categories" aria-labelledby="home-categories-title">
          <div className="home-section-heading"><h2 id="home-categories-title">按主题浏览</h2><span>同一篇论文可属于多个主题</span></div>
          <div className="category-grid">{categories.map(item => <AppLink key={item.id} className={`category-card${category === item.id ? ' is-active' : ''}`}
            href={browseHref(params, { category: item.id })} onNavigate={onNavigate} aria-current={category === item.id ? 'page' : undefined}>
            <div><h3>{item.title}</h3><span>{item.count} 篇 <ArrowUpRight size={16} aria-hidden="true" /></span></div><p>{item.description}</p>
          </AppLink>)}</div>
        </section>}
        {current && <nav className="category-switcher" aria-label="切换论文主题">{categories.map(item => <AppLink key={item.id} href={browseHref(params, { category: item.id })} onNavigate={onNavigate} aria-current={category === item.id ? 'page' : undefined}>{item.title}<span>{item.count}</span></AppLink>)}</nav>}
        <section id="home-papers" className="home-papers" aria-labelledby="home-papers-title">
          <div className="home-section-heading"><h2 id="home-papers-title">{current?.title ?? '全部论文'} <span aria-live="polite" aria-atomic="true">{matches.length} 篇</span></h2>
            {filtered && <AppLink href="/" onNavigate={onNavigate} className="home-reset"><ArrowLeft size={15} aria-hidden="true" />全部论文</AppLink>}
          </div>
          <div className="home-filters">
            <label>模型与方法<select aria-label="模型与方法" value={family} onChange={event => update({ family: event.target.value || null })}><option value="">全部系列</option>{families.map(tag => <option key={tag} value={tag}>{tagLabel(tag)}</option>)}</select></label>
            <label>排序<select aria-label="排序" value={sort} onChange={event => update({ sort: event.target.value === 'catalog' ? null : event.target.value }, true)}><option value="catalog">默认顺序</option><option value="year">年份从新到旧</option><option value="oldest">年份从旧到新</option><option value="title">标题 A–Z</option></select></label>
            {current && <p>{current.description}</p>}
          </div>
          <div className="home-paper-grid">{matches.map(paper => <article key={paper.id} className="home-paper-card">
            <div className="home-paper-meta"><span>{paper.year}</span><span>{paper.access === 'source-only' ? '来源条目' : paper.translationStatus === 'machine' ? '中英对照' : '英文原文'}</span></div>
            <h3><AppLink href={(() => { const next = new URLSearchParams(params); next.set('paper', paper.id); return `/?${next}` })()}
              onNavigate={() => onPaper(paper.id)}>{paper.titleZh || paper.title}</AppLink></h3>
            {paper.titleZh && paper.titleZh !== paper.title && <p className="home-paper-original" lang="en">{paper.title}</p>}
            <p className="home-paper-authors">{shortPaperAuthors(paper)}</p>
            <PaperTags tags={paper.tags} compact />
            <span className="home-read-hint"><BookOpen size={14} aria-hidden="true" />阅读论文<ArrowUpRight size={14} aria-hidden="true" /></span>
          </article>)}</div>
          {matches.length === 0 && <div className="home-no-results"><h3>{papers.length ? '没有找到匹配的论文' : '论文库暂无内容'}</h3><p>试试其他关键词或返回全部论文。</p>{filtered && <AppLink href="/" onNavigate={onNavigate}>清除筛选</AppLink>}</div>}
        </section>
        {reports.length > 0 && <section id="home-research" className="home-research" aria-labelledby="home-research-title"><div className="home-section-heading"><h2 id="home-research-title">研究产出</h2><span>中文调研与综述</span></div>
          {reports.map(report => <AppLink key={report.id} href={`/?research=${encodeURIComponent(report.id)}`} onNavigate={onNavigate} className="home-report"><div><h3>{report.title}</h3><p>{report.summary}</p><span>{report.date}</span></div><ArrowUpRight size={20} aria-hidden="true" /></AppLink>)}
        </section>}
      </>}
      <footer className="home-footer">Papero · {papers.length} 篇论文 · 中文机器翻译，以英文原文为准</footer>
    </main>
  </div>
}
