import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

/** Both mobile navigation drawers share focus trapping and return focus to their opener. */
export function useNavigationDrawer(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    return () => { previous?.focus() }
  }, [active])

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!active) return
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, a[href]') ?? [])
      .filter(element => !element.closest('[hidden], [inert]'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return { ref, onKeyDown }
}
