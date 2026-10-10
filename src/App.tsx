import { ArrowUpRight, Menu } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { PaperHeader } from './components/PaperHeader'
import { PaperReader } from './components/PaperReader'
import type { PaperReaderHandle, ReadingPosition } from './components/PaperReader'
import { ReaderToolbar } from './components/ReaderToolbar'
import { ReaderState } from './components/ReaderState'
import { ThemeControl } from './components/ThemeControl'
import { usePaperLibrary } from './hooks/usePaperLibrary'
import { useMediaQuery, usePreferences } from './hooks/usePreferences'
import { getPaperDataBaseUrl } from './lib/paper-data'

export default function App() {
  const library = usePaperLibrary()
  const [preferences, setPreferences] = usePreferences()
  const mobile = useMediaQuery('(max-width: 760px)')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [position, setPosition] = useState<ReadingPosition>({ progress: 0, sectionId: null })
  const reader = useRef<PaperReaderHandle>(null)
  const paper = library.document.value?.id === library.selected?.id ? library.document.value : null
  const remoteData = /^https?:\/\//i.test(getPaperDataBaseUrl())
  const onPosition = useCallback((next: ReadingPosition) => setPosition(next), [])

  useEffect(() => {
    setPosition({ progress: 0, sectionId: null })
  }, [library.selected?.id])

  useEffect(() => {
    document.title = library.selected ? `${library.selected.title} · Papero` : 'Papero · 中英论文阅读器'
  }, [library.selected])

  useEffect(() => {
    if (!mobile) setSidebarOpen(false)
  }, [mobile])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    const colors = { light: '#ffffff', dark: '#212121', warm: '#fff9ef' }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[preferences.theme])
  }, [preferences.theme])

  const catalogEmpty = library.catalog.status === 'ready' && library.catalog.value.papers.length === 0
  const sectionLevels = paper?.sections.filter((section) => section.level && section.level < 6 && section.id !== 'frontmatter').map((section) => section.level!) ?? []
  const baseLevel = sectionLevels.length ? Math.min(...sectionLevels) : 1
  const sections = paper?.sections.map((section) => ({
    ...section,
    level: section.title.toLowerCase() === 'abstract' || section.id === 'frontmatter'
      ? 1 : Math.min(3, Math.max(1, (section.level ?? baseLevel) - baseLevel + 1)),
  })) ?? []

  return <div className="app-shell">
    <Sidebar papers={library.catalog.value?.papers ?? []} selectedId={library.selected?.id}
      sections={sections} activeSection={position.sectionId} remoteData={remoteData} loading={library.catalog.status === 'loading'}
      mobile={mobile} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onSelect={library.selectPaper}
      onNavigate={(id) => reader.current?.navigate(id)} />
    <main className="main-area" inert={mobile && sidebarOpen ? true : undefined}>
      <div className="topbar">
        <div className="breadcrumb">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="打开论文库与目录"
            aria-expanded={sidebarOpen} aria-controls="paper-sidebar"><Menu size={21} aria-hidden="true" /></button>
          <span className="breadcrumb-library">论文库</span>
          {library.selected && <><span className="breadcrumb-slash" aria-hidden="true">/</span><span className="breadcrumb-title">{library.selected.title}</span></>}
        </div>
        <div className="topbar-actions">
          <ThemeControl theme={preferences.theme} onChange={(theme) => setPreferences((current) => ({ ...current, theme }))} />
          {library.selected && <a className="source-link" href={library.selected.sourceHtmlUrl} target="_blank" rel="noopener noreferrer"
            title={library.selected.arxivId === null ? '在 Qwen 打开官方发布文章' : '在 arXiv 打开英文 HTML 原文'}>
            {library.selected.arxivId === null ? 'Qwen' : 'arXiv'} <ArrowUpRight size={16} aria-hidden="true" /></a>}
        </div>
      </div>
      {library.catalog.status === 'loading' ? <ReaderState kind="loading" />
        : library.catalog.status === 'error' ? <ReaderState kind="error" error={library.catalog.error} missing={library.isMissing} onRetry={library.reloadCatalog} />
          : catalogEmpty || !library.selected ? <ReaderState kind="empty" onRetry={library.reloadCatalog} />
            : <div className="paper-workspace">
              <PaperHeader entry={library.selected} paper={paper} />
              <ReaderToolbar preferences={preferences} onChange={(patch) => setPreferences((current) => ({ ...current, ...patch }))} />
              {library.document.status === 'error' ? <ReaderState kind="error" scope="paper" error={library.document.error} onRetry={library.reloadPaper} />
                : paper ? <PaperReader key={paper.id} ref={reader} paper={paper} entry={library.selected} preferences={preferences} onPosition={onPosition} />
                  : <ReaderState kind="loading" scope="paper" />}
            </div>}
      <footer className="reading-footer">
        <div className="reading-progress"><span>阅读进度</span><span className="progress-number">{Math.round(position.progress)}%</span>
          <div className="progress-track" role="progressbar" aria-label="论文阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position.progress)}>
            <span style={{ width: `${position.progress}%` }} />
          </div>
        </div>
        <span className="reading-note">{paper?.translation.status === 'machine' ? '中文机器翻译 · 以英文原文为准' : paper ? '英文原文已就绪 · 中文译文待生成' : '中英段落对齐阅读'}</span>
      </footer>
    </main>
  </div>
}
