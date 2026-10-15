import { useCallback, useEffect, useState } from 'react'
import { loadCatalog, loadPaper, PaperDataError } from '../lib/paper-data'
import type { CatalogPaper, PaperCatalog, PaperDocument } from '../types'

type Resource<T> =
  | { status: 'loading'; value: null; error: null }
  | { status: 'ready'; value: T; error: null }
  | { status: 'error'; value: null; error: Error }

const loading = { status: 'loading', value: null, error: null } as const
const LAST_PAPER = 'papero:last-paper:v1'

function lastSelectedPaper(): string | null {
  const query = new URL(window.location.href).searchParams.get('paper')
  if (query) return query
  try { return localStorage.getItem(LAST_PAPER) } catch { return null }
}

export function usePaperLibrary(active = true) {
  const [catalog, setCatalog] = useState<Resource<PaperCatalog>>(loading)
  const [selectedId, setSelectedId] = useState<string | null>(lastSelectedPaper)
  const [document, setDocument] = useState<Resource<PaperDocument> | { status: 'source-only'; value: null; error: null }>(loading)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [paperRevision, setPaperRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setCatalog(loading)
    loadCatalog({ signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return
      setCatalog({ status: 'ready', value, error: null })
      setSelectedId((id) => value.papers.some((paper) => paper.id === id) ? id : value.papers[0]?.id ?? null)
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCatalog({ status: 'error', value: null, error: error instanceof Error ? error : new Error('无法读取论文库。') })
    })
    return () => controller.abort()
  }, [catalogRevision])

  const selected: CatalogPaper | undefined = catalog.value?.papers.find((paper) => paper.id === selectedId)

  useEffect(() => {
    if (!selected || !active) return
    const controller = new AbortController()
    if (selected.access === 'source-only') {
      setDocument({ status: 'source-only', value: null, error: null })
    } else {
      setDocument(loading)
      loadPaper(selected, { signal: controller.signal }).then((value) => {
        if (!controller.signal.aborted) setDocument({ status: 'ready', value, error: null })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setDocument({ status: 'error', value: null, error: error instanceof Error ? error : new Error('无法读取论文。') })
      })
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('research')
    url.searchParams.set('paper', selected.id)
    history.replaceState(null, '', url)
    try { localStorage.setItem(LAST_PAPER, selected.id) } catch { /* Optional preference. */ }
    return () => controller.abort()
  }, [selected, paperRevision, active])

  const selectPaper = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  return {
    catalog, document, selected, selectPaper,
    reloadCatalog: () => setCatalogRevision((revision) => revision + 1),
    reloadPaper: () => setPaperRevision((revision) => revision + 1),
    isMissing: catalog.error instanceof PaperDataError && catalog.error.code === 'missing',
  }
}
