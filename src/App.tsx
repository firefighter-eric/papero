import { ArrowUpRight, Library, ListTree } from 'lucide-react'
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

export default function App() {
  const library = usePaperLibrary()
  const [preferences, setPreferences] = usePreferences()
  const mobile = useMediaQuery('(max-width: 760px)')
  const [libraryCollapsed, setLibraryCollapsed] = useLibraryPanel()
  const shell = useRef<HTMLDivElement>(null)
  const widths = useSidebarWidths(shell, libraryCollapsed)
  const [drawer, setDrawer] = useState<'library' | 'toc' | null>(null)
  const closeDrawer = useCallback(() => setDrawer(null), [])
  const [position, setPosition] = useState<ReadingPosition>({ progress: 0, sectionId: null, headerCollapseProgress: 0 })
  const reader = useRef<PaperReaderHandle>(null)
  const paper = library.document.value?.id === library.selected?.id ? library.document.value : null
  const sourceLink = library.selected ? paperSourceLink(library.selected, paper) : null
  const remoteData = /^https?:\/\//i.test(getPaperDataBaseUrl())
  const onPosition = useCallback((next: ReadingPosition) => setPosition(next), [])

  useEffect(() => {
    setPosition({ progress: 0, sectionId: null, headerCollapseProgress: 0 })
  }, [library.selected?.id])

  useEffect(() => {
    document.title = library.selected ? `${library.selected.title} · Papero` : 'Papero · 中英论文阅读器'
  }, [library.selected])

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

  return <div ref={shell} className={`app-shell${libraryCollapsed ? ' is-library-collapsed' : ''}`}
    style={{ '--library-width': `${widths.library}px`, '--toc-width': `${widths.toc}px` } as CSSProperties}>
    <Sidebar papers={library.catalog.value?.papers ?? []} selectedId={library.selected?.id}
      remoteData={remoteData} loading={library.catalog.status === 'loading'} collapsed={libraryCollapsed}
      mobile={mobile} open={drawer === 'library'} onClose={closeDrawer} onSelect={library.selectPaper}
      onToggle={() => setLibraryCollapsed(!libraryCollapsed)} />
    {!mobile && !libraryCollapsed && <SidebarResizeHandle label="调节论文检索栏宽度" controls="paper-sidebar"
      value={widths.library} min={SIDEBAR_WIDTH_LIMITS.library.min} max={widths.libraryMax} defaultValue={SIDEBAR_WIDTH_DEFAULTS.library}
      onChange={value => widths.setWidth('library', value)} />}
    <TableOfContents key={library.selected?.id} entry={library.selected} sections={sections} activeSection={position.sectionId}
      mobile={mobile} open={drawer === 'toc'} loading={library.catalog.status === 'loading' || Boolean(library.selected && library.document.status === 'loading')} onClose={closeDrawer}
      onNavigate={id => reader.current?.navigate(id)} />
    {!mobile && <SidebarResizeHandle label="调节本文目录栏宽度" controls="paper-toc"
      value={widths.toc} min={SIDEBAR_WIDTH_LIMITS.toc.min} max={widths.tocMax} defaultValue={SIDEBAR_WIDTH_DEFAULTS.toc}
      onChange={value => widths.setWidth('toc', value)} />}
    <main className="main-area" inert={mobile && drawer !== null ? true : undefined}>
      <div className="topbar">
        <div className="breadcrumb">
          <button className="icon-button menu-button" onClick={() => setDrawer('library')} aria-label="打开论文检索"
            aria-expanded={drawer === 'library'} aria-controls="paper-sidebar"><Library size={20} aria-hidden="true" /></button>
          <button className="icon-button menu-button toc-menu-button" onClick={() => setDrawer('toc')} aria-label="打开本文目录"
            aria-expanded={drawer === 'toc'} aria-controls="paper-toc"><ListTree size={20} aria-hidden="true" /></button>
          <span className="breadcrumb-library">论文库</span>
          {library.selected && <><span className="breadcrumb-slash" aria-hidden="true">/</span><span className="breadcrumb-title">{library.selected.title}</span></>}
        </div>
        {library.catalog.status === 'ready' && library.selected && library.selected.access !== 'source-only' &&
          <ReaderToolbar preferences={preferences} onChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))} />}
        <div className="topbar-actions">
          <ThemeControl theme={preferences.theme} onChange={(theme) => setPreferences((current) => ({ ...current, theme }))} />
          {library.selected && sourceLink && <a className="source-link" href={sourceLink.url} target="_blank" rel="noopener noreferrer"
            title={sourceLink.title}>
            {library.selected.arxivId === null ? '原文' : 'arXiv'} <ArrowUpRight size={16} aria-hidden="true" /></a>}
        </div>
      </div>
      {library.catalog.status === 'loading' ? <ReaderState kind="loading" />
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
        {library.selected?.access === 'source-only' ? <span>来源信息 · 全文保留在本地</span> : <>
          <div className="reading-progress"><span>阅读进度</span><span className="progress-number">{Math.round(position.progress)}%</span>
            <div className="progress-track" role="progressbar" aria-label="论文阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position.progress)}>
              <span style={{ width: `${position.progress}%` }} />
            </div>
          </div>
          <span className="reading-note">{paper?.translation.status === 'machine' ? '中文机器翻译 · 以英文原文为准' : paper ? '英文原文已就绪 · 中文译文待生成' : '中英段落对齐阅读'}</span>
        </>}
      </footer>
    </main>
  </div>
}
