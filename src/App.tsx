import { ArrowUpRight, Home, Library, ListTree } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Sidebar } from './components/Sidebar'
import { TableOfContents } from './components/TableOfContents'
import { SidebarResizeHandle } from './components/SidebarResizeHandle'
import { PaperHeader } from './components/PaperHeader'
import { PaperReader } from './components/PaperReader'
import { PaperSource } from './components/PaperSource'
import type { PaperReaderHandle, ReadingPosition } from './components/PaperReader'
import { ReaderToolbar } from './components/ReaderToolbar'
import { ReaderState } from './components/ReaderState'
import { ThemeControl } from './components/ThemeControl'
import { usePaperLibrary } from './hooks/usePaperLibrary'
import { useMediaQuery, usePreferences } from './hooks/usePreferences'
import { useLibraryPanel } from './hooks/useLibraryPanel'
import { SIDEBAR_WIDTH_DEFAULTS, SIDEBAR_WIDTH_LIMITS, useSidebarWidths } from './hooks/useSidebarWidths'
import { getPaperDataBaseUrl } from './lib/paper-data'
import { paperSourceLink } from './lib/paper-source'
import { useResearchLibrary } from './hooks/useResearchLibrary'
import { ResearchReader } from './components/ResearchReader'
import { ResearchDownload } from './components/ResearchDownload'
import { LibraryHome } from './components/LibraryHome'
import { AppLink } from './components/AppLink'
import { browseHref, PAPER_CATEGORIES } from './lib/paper-categories'

export default function App() {
  const [location, setLocation] = useState(() => new URL(window.location.href))
  const view = location.searchParams.has('research') ? 'research' : location.searchParams.has('paper') ? 'papers' : 'home'
  const researchId = location.searchParams.get('research') || null
  const library = usePaperLibrary(view === 'papers')
  const research = useResearchLibrary(view === 'research', researchId)
  const researchReader = useRef<{ navigate: (id: string) => void }>(null)
  const [preferences, setPreferences] = usePreferences()
  const mobile = useMediaQuery('(max-width: 760px)')
  const [libraryCollapsed, setLibraryCollapsed] = useLibraryPanel()
  const shell = useRef<HTMLDivElement>(null)
  const widths = useSidebarWidths(shell, libraryCollapsed, view !== 'home')
  const homePositions = useRef(new Map<string, number>())
  const [drawer, setDrawer] = useState<'library' | 'toc' | null>(null)
  const closeDrawer = useCallback(() => setDrawer(null), [])
  const [position, setPosition] = useState<ReadingPosition>({ progress: 0, sectionId: null, headerCollapseProgress: 0 })
  const reader = useRef<PaperReaderHandle>(null)
  const paper = library.document.value?.id === library.selected?.id ? library.document.value : null
  const sourceLink = library.selected ? paperSourceLink(library.selected, paper) : null
  const remoteData = /^https?:\/\//i.test(getPaperDataBaseUrl())
  const onPosition = useCallback((next: ReadingPosition) => setPosition(next), [])
  const navigate = useCallback((href: string, replace = false) => {
    const next = new URL(href, window.location.href)
    if (next.href !== window.location.href) {
      if (replace) history.replaceState(null, '', next)
      else history.pushState(null, '', next)
    }
    setLocation(next)
    setDrawer(null)
  }, [])
  const showHome = useCallback(() => { homePositions.current.set('', 0); navigate('/') }, [navigate])
  const showResearch = useCallback((id: string | null, replace = false) => {
    navigate(`/?research=${encodeURIComponent(id ?? '')}`, replace)
  }, [navigate])
  const showPaper = useCallback((id?: string) => {
    const selectedId = id ?? library.selected?.id
    if (!selectedId) { showHome(); return }
    const url = new URL(window.location.href)
    url.searchParams.delete('research'); url.searchParams.set('paper', selectedId); url.hash = ''
    navigate(url.href)
    library.selectPaper(selectedId)
  }, [library.selectPaper, library.selected?.id, navigate, showHome])
  useEffect(() => {
    if (view === 'research' && !researchId && research.selected) showResearch(research.selected.id, true)
  }, [view, researchId, research.selected, showResearch])
  useEffect(() => {
    const restore = () => { setLocation(new URL(window.location.href)); setDrawer(null) }
    window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore)
  }, [])
  useLayoutEffect(() => {
    const paperId = location.searchParams.get('paper')
    if (view === 'papers' && paperId) library.selectPaper(paperId)
  }, [location, view, library.selectPaper])

  useEffect(() => {
    setPosition({ progress: 0, sectionId: null, headerCollapseProgress: 0 })
  }, [library.selected?.id, research.selected?.id, view])

  useEffect(() => {
    const category = PAPER_CATEGORIES.find(item => item.id === location.searchParams.get('category'))
    document.title = view === 'home' ? `${category?.title ?? '按类别探索 AI 论文'} · Papero` : view === 'research' ? `${research.selected?.title ?? '研究产出'} · Papero`
      : library.selected ? `${library.selected.title} · Papero` : 'Papero · 中英论文阅读器'
  }, [library.selected, research.selected, view, location])

  useEffect(() => {
    if (!mobile) setDrawer(null)
  }, [mobile])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    const colors = { light: '#ffffff', dark: '#212121', warm: '#fff9ef' }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[preferences.theme])
  }, [preferences.theme])

  const catalogEmpty = library.catalog.status === 'ready' && library.catalog.value.papers.length === 0
  const sections = useMemo(() => {
    const levels = paper?.sections.filter(section => section.level && section.level < 6 && section.id !== 'frontmatter').map(section => section.level!) ?? []
    const baseLevel = levels.length ? Math.min(...levels) : 1
    return paper?.sections.map(section => ({
      ...section,
      level: section.title.toLowerCase() === 'abstract' || section.id === 'frontmatter'
        ? 1 : Math.min(3, Math.max(1, (section.level ?? baseLevel) - baseLevel + 1)),
    })) ?? []
  }, [paper])

  if (view === 'home') return <LibraryHome papers={library.catalog.value?.papers ?? []} reports={research.reports}
    params={location.searchParams} theme={preferences.theme} onTheme={theme => setPreferences(current => ({ ...current, theme }))}
    onNavigate={navigate} onPaper={showPaper} scrollPositions={homePositions.current}>
    {library.catalog.status === 'loading' ? <ReaderState kind="loading" />
      : library.catalog.status === 'error' ? <ReaderState kind="error" error={library.catalog.error} missing={library.isMissing} onRetry={library.reloadCatalog} /> : undefined}
  </LibraryHome>

  return <div ref={shell} className={`app-shell${libraryCollapsed ? ' is-library-collapsed' : ''}`}
    style={{ '--library-width': `${widths.library}px`, '--toc-width': `${widths.toc}px` } as CSSProperties}>
    <Sidebar papers={library.catalog.value?.papers ?? []} selectedId={library.selected?.id}
      remoteData={remoteData} loading={library.catalog.status === 'loading'} collapsed={libraryCollapsed}
      mobile={mobile} open={drawer === 'library'} onClose={closeDrawer} onSelect={id => showPaper(id)}
      reports={research.reports} view={view} selectedResearchId={view === 'research' ? research.selected?.id : undefined}
      researchLoading={research.catalogLoading} onView={next => next === 'research' ? showResearch(researchId) : showPaper()}
      onResearchSelect={showResearch}
      onHome={showHome}
      onToggle={() => setLibraryCollapsed(!libraryCollapsed)} />
    {!mobile && !libraryCollapsed && <SidebarResizeHandle label="调节论文检索栏宽度" controls="paper-sidebar"
      value={widths.library} min={SIDEBAR_WIDTH_LIMITS.library.min} max={widths.libraryMax} defaultValue={SIDEBAR_WIDTH_DEFAULTS.library}
      onChange={value => widths.setWidth('library', value)} />}
    <TableOfContents key={view === 'research' ? research.selected?.id : library.selected?.id}
      entry={view === 'research' ? research.selected && { title: research.selected.title, year: Number(research.selected.date.slice(0, 4)) } : library.selected}
      sections={view === 'research' ? (research.document?.id === research.selected?.id ? research.document?.sections.map(s => ({ ...s, titleZh: s.title })) ?? [] : []) : sections}
      activeSection={position.sectionId} mobile={mobile} open={drawer === 'toc'}
      loading={view === 'research' ? research.catalogLoading || research.loading : library.catalog.status === 'loading' || Boolean(library.selected && library.document.status === 'loading')}
      onClose={closeDrawer} onNavigate={id => view === 'research' ? researchReader.current?.navigate(id) : reader.current?.navigate(id)} />
    {!mobile && <SidebarResizeHandle label="调节本文目录栏宽度" controls="paper-toc"
      value={widths.toc} min={SIDEBAR_WIDTH_LIMITS.toc.min} max={widths.tocMax} defaultValue={SIDEBAR_WIDTH_DEFAULTS.toc}
      onChange={value => widths.setWidth('toc', value)} />}
    <main className="main-area" inert={mobile && drawer !== null ? true : undefined}>
      <div className="topbar">
        <div className="breadcrumb">
          <AppLink className="icon-button reader-home" href={browseHref(location.searchParams, {})} onNavigate={navigate} aria-label="返回论文分类" title="返回论文分类"><Home size={18} aria-hidden="true" /></AppLink>
          <button className="icon-button menu-button" onClick={() => setDrawer('library')} aria-label="打开论文检索"
            aria-expanded={drawer === 'library'} aria-controls="paper-sidebar"><Library size={20} aria-hidden="true" /></button>
          <button className="icon-button menu-button toc-menu-button" onClick={() => setDrawer('toc')} aria-label="打开本文目录"
            aria-expanded={drawer === 'toc'} aria-controls="paper-toc"><ListTree size={20} aria-hidden="true" /></button>
          <span className="breadcrumb-library">{view === 'research' ? '研究产出' : '论文库'}</span>
          {(view === 'research' ? research.selected : library.selected) && <><span className="breadcrumb-slash" aria-hidden="true">/</span><span className="breadcrumb-title">{view === 'research' ? research.selected?.title : library.selected?.title}</span></>}
        </div>
        {view === 'research' && <div className="research-font-controls" role="group" aria-label="报告字号">
          <button onClick={() => setPreferences(p => ({ ...p, fontSize: Math.max(14, p.fontSize - 1) }))} aria-label="减小报告字号">A−</button>
          <button onClick={() => setPreferences(p => ({ ...p, fontSize: Math.min(24, p.fontSize + 1) }))} aria-label="增大报告字号">A+</button>
        </div>}
        {view === 'papers' && library.catalog.status === 'ready' && library.selected && library.selected.access !== 'source-only' &&
          <ReaderToolbar preferences={preferences} onChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))} />}
        <div className="topbar-actions">
          <ThemeControl theme={preferences.theme} onChange={(theme) => setPreferences((current) => ({ ...current, theme }))} />
          {view === 'research' && research.document && <ResearchDownload report={research.document} />}
          {view === 'papers' && library.selected && sourceLink && <a className="source-link" href={sourceLink.url} target="_blank" rel="noopener noreferrer"
            title={sourceLink.title}>
            {library.selected.arxivId === null ? '原文' : 'arXiv'} <ArrowUpRight size={16} aria-hidden="true" /></a>}
        </div>
      </div>
      {view === 'research' ? research.catalogLoading ? <ReaderState kind="loading" scope="research" />
        : research.catalogError || research.error ? <ReaderState kind="error" scope="research" error={(research.catalogError || research.error)!} onRetry={research.retry} />
          : !research.selected ? <div className="research-empty"><p>{researchId ? '未找到这份研究报告。' : '研究产出暂无内容。'}</p><button onClick={() => showResearch(null)}>返回研究产出</button></div>
            : research.loading || research.document?.id !== research.selected.id ? <ReaderState kind="loading" scope="research" />
              : <div className="paper-workspace research-workspace">
                <div className="research-meta-bar"><span>中文调研 · {research.document.date} · {research.document.sources.length} 个引用来源 · v{research.document.revision}</span>
                  <details><summary>关联论文</summary><div className="research-related-papers">{research.document.sources.filter(s => s.localPaperId && library.catalog.value?.papers.some(p => p.id === s.localPaperId)).map(s => <button key={s.id} onClick={() => showPaper(s.localPaperId)}>{s.title}</button>)}</div></details>
                </div>
                <ResearchReader key={research.document.id} ref={researchReader} report={research.document} fontSize={preferences.fontSize} onPosition={onPosition} />
              </div>
        : library.catalog.status === 'loading' ? <ReaderState kind="loading" />
        : library.catalog.status === 'error' ? <ReaderState kind="error" error={library.catalog.error} missing={library.isMissing} onRetry={library.reloadCatalog} />
          : catalogEmpty || !library.selected ? <ReaderState kind="empty" onRetry={library.reloadCatalog} />
            : <div className="paper-workspace" style={{ '--heading-collapse': paper ? position.headerCollapseProgress : 0 } as CSSProperties}>
              <PaperHeader key={library.selected.id} entry={library.selected} paper={paper}
                collapseProgress={paper ? position.headerCollapseProgress : 0} />
              {library.selected.access === 'source-only' ? <PaperSource entry={library.selected} /> : <>
                {library.document.status === 'error' ? <ReaderState kind="error" scope="paper" error={library.document.error} onRetry={library.reloadPaper} />
                  : paper ? <PaperReader key={paper.id} ref={reader} paper={paper} entry={library.selected} preferences={preferences}
                    layoutKey={`${mobile ? 'mobile' : 'desktop'}:${widths.library}:${widths.toc}`} onPosition={onPosition} />
                    : <ReaderState kind="loading" scope="paper" />}
              </>}
            </div>}
      <footer className="reading-footer">
        {view === 'papers' && library.selected?.access === 'source-only' ? <span>来源信息 · 全文保留在本地</span> : <>
          <div className="reading-progress"><span>阅读进度</span><span className="progress-number">{Math.round(position.progress)}%</span>
            <div className="progress-track" role="progressbar" aria-label={view === 'research' ? '报告阅读进度' : '论文阅读进度'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position.progress)}>
              <span style={{ width: `${position.progress}%` }} />
            </div>
          </div>
          <span className="reading-note">{view === 'research' ? 'AI 综合研究 · 未经人工审校 · 引用可回查' : paper?.translation.status === 'machine' ? '中文机器翻译 · 以英文原文为准' : paper ? '英文原文已就绪 · 中文译文待生成' : '中英段落对齐阅读'}</span>
        </>}
      </footer>
    </main>
  </div>
}
