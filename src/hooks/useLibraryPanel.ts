import { useEffect, useState } from 'react'
import { useMediaQuery } from './usePreferences'

const KEY = 'papero:library-panel:v1'

function savedPreference(): boolean | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    return typeof value === 'boolean' ? value : null
  } catch { return null }
}

export function useLibraryPanel() {
  const compact = useMediaQuery('(max-width: 1150px)')
  const [preference, setPreference] = useState(savedPreference)
  useEffect(() => {
    if (preference === null) return
    try { localStorage.setItem(KEY, JSON.stringify(preference)) } catch { /* Optional layout preference. */ }
  }, [preference])
  return [preference ?? compact, setPreference] as const
}
