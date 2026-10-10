export interface ReadingAnchor {
  blockId: string
  fraction: number
}

function key(paperId: string) { return `papero:reading:v1:${paperId}` }

export function readSavedAnchor(paperId: string): ReadingAnchor | null {
  try {
    const anchor = JSON.parse(localStorage.getItem(key(paperId)) || 'null') as Partial<ReadingAnchor> | null
    if (anchor && typeof anchor.blockId === 'string' && anchor.blockId.length <= 160
      && typeof anchor.fraction === 'number' && Number.isFinite(anchor.fraction)) {
      return { blockId: anchor.blockId, fraction: Math.max(0, Math.min(1, anchor.fraction)) }
    }
  } catch { /* Invalid or unavailable storage starts at the beginning. */ }
  return null
}

export function saveAnchor(paperId: string, anchor: ReadingAnchor | null) {
  if (!anchor) return
  try { localStorage.setItem(key(paperId), JSON.stringify(anchor)) } catch { /* Position persistence is optional. */ }
}
