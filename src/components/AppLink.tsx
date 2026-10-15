import type { ComponentPropsWithoutRef } from 'react'

type Props = ComponentPropsWithoutRef<'a'> & { onNavigate?: (href: string) => void }

/** Keep real links usable with keyboard, new tabs, and browser history. */
export function AppLink({ onNavigate, onClick, ...props }: Props) {
  return <a {...props} onClick={event => {
    onClick?.(event)
    if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank') return
    event.preventDefault()
    onNavigate(event.currentTarget.getAttribute('href')!)
  }} />
}
