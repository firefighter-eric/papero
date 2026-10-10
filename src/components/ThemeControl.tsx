import { Moon, Palette, Sun } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { ReaderTheme } from '../hooks/usePreferences'

const themes = [
  { value: 'light', label: '白色', description: '白色主题', Icon: Sun },
  { value: 'dark', label: '黑色', description: '黑色主题', Icon: Moon },
  { value: 'warm', label: '暖橙', description: 'Anthropic 浅橙色主题', Icon: Palette },
] as const

export function ThemeControl({ theme, onChange }: { theme: ReaderTheme; onChange: (theme: ReaderTheme) => void }) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % themes.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + themes.length - 1) % themes.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = themes.length - 1
    else return
    event.preventDefault()
    onChange(themes[next].value)
    event.currentTarget.closest('[role="radiogroup"]')
      ?.querySelector<HTMLButtonElement>(`[data-theme-value="${themes[next].value}"]`)?.focus()
  }

  return <div className="theme-control" role="radiogroup" aria-label="阅读主题">
    {themes.map(({ value, label, description, Icon }, index) => <button key={value} type="button" role="radio"
      aria-label={description} aria-checked={theme === value} title={description} data-theme-value={value}
      tabIndex={theme === value ? 0 : -1} className={theme === value ? 'is-selected' : ''}
      onClick={() => onChange(value)} onKeyDown={(event) => onKeyDown(event, index)}>
      <Icon size={15} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>
    </button>)}
  </div>
}
