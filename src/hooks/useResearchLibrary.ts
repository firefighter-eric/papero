import { useEffect, useState } from 'react'
import { loadResearchCatalog, loadResearchDocument } from '../lib/research-data'
import type { ResearchEntry } from '../types'

export function useResearchLibrary(active: boolean, id: string | null) {
  const [reports, setReports] = useState<ResearchEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<Error | null>(null)
  const [revision, setRevision] = useState(0)
  const [document, setDocument] = useState<Awaited<ReturnType<typeof loadResearchDocument>> | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError(null)
    loadResearchCatalog({ signal: controller.signal }).then(c => { if (!controller.signal.aborted) setReports(c.reports) })
      .catch(e => { if (!controller.signal.aborted) setCatalogError(e instanceof Error ? e : new Error(String(e))) })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [revision])
  const selected = reports.find(r => r.id === id) ?? (id === null ? reports[0] : undefined)
  useEffect(() => {
    if (!active || !selected) return
    const controller = new AbortController()
    setLoading(true); setError(null); setDocument(null)
    loadResearchDocument(selected, { signal: controller.signal }).then(d => { if (!controller.signal.aborted) setDocument(d) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e : new Error(String(e))) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, selected, revision])
  return { reports, selected, document, loading, error, catalogLoading, catalogError, retry: () => setRevision(r => r + 1) }
}
