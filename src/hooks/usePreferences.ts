import { useEffect, useState } from 'react'

export type ReaderMode = 'bilingual' | 'zh' | 'en'
export type ReaderTheme = 'light' | 'dark' | 'warm'
export interface ReaderPreferences {
  mode: ReaderMode
  swapped: boolean
  synced: boolean
  fontSize: number
  theme: ReaderTheme
}

const KEY = 'papero:preferences:v1'

function initialPreferences(): ReaderPreferences {
  const defaults: ReaderPreferences = {
    mode: window.matchMedia('(max-width: 760px)').matches ? 'zh' : 'bilingual',
    swapped: false,
    synced: true,
    fontSize: 19,
    theme: 'light',
  }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!value || typeof value !== 'object') return defaults
    const stored = value as Partial<ReaderPreferences>
    return {
      mode: ['bilingual', 'zh', 'en'].includes(stored.mode ?? '') ? stored.mode! : defaults.mode,
      swapped: typeof stored.swapped === 'boolean' ? stored.swapped : defaults.swapped,
      synced: typeof stored.synced === 'boolean' ? stored.synced : defaults.synced,
      fontSize: typeof stored.fontSize === 'number' && Number.isFinite(stored.fontSize)
        ? Math.max(15, Math.min(25, stored.fontSize)) : defaults.fontSize,
      theme: ['light', 'dark', 'warm'].includes(stored.theme ?? '') ? stored.theme! : defaults.theme,
    }
  } catch {
    return defaults
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState(initialPreferences)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)) } catch { /* Reading works without storage. */ }
  }, [preferences])
  return [preferences, setPreferences] as const
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}
