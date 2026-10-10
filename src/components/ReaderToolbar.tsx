import { ArrowLeftRight, Minus, Plus } from 'lucide-react'
import type { ReaderMode, ReaderPreferences } from '../hooks/usePreferences'

interface Props {
  preferences: ReaderPreferences
  onChange: (patch: Partial<ReaderPreferences>) => void
}

export function ReaderToolbar({ preferences, onChange }: Props) {
  const options: { mode: ReaderMode; label: string }[] = [
    { mode: 'bilingual', label: '双栏对照' },
    { mode: 'zh', label: '仅中文' },
    { mode: 'en', label: '仅英文' },
  ]
  return <div className="reader-toolbar" role="toolbar" aria-label="阅读设置">
    <div className="toolbar-primary">
      <div className="mode-control" role="group" aria-label="阅读语言">
        {options.map(({ mode, label }) => <button key={mode} aria-pressed={preferences.mode === mode}
          className={preferences.mode === mode ? 'is-selected' : ''} onClick={() => onChange({ mode })}>{label}</button>)}
      </div>
      <button className="swap-button" disabled={preferences.mode !== 'bilingual'} onClick={() => onChange({ swapped: !preferences.swapped })}
        title="交换中文和英文的位置" aria-label="交换中文和英文的位置"><ArrowLeftRight size={17} aria-hidden="true" /><span>交换</span></button>
    </div>
    <div className="toolbar-secondary">
      <button className="sync-control" role="switch" aria-checked={preferences.synced}
        disabled={preferences.mode !== 'bilingual'} onClick={() => onChange({ synced: !preferences.synced })}
        title="双向同步：滚动或拖动任意一侧滚动条，另一侧跟随对应段落"><span>同步滚动</span><span className={`switch-track ${preferences.synced ? 'is-on' : ''}`} aria-hidden="true"><span /></span></button>
      <div className="font-control" role="group" aria-label="正文字号">
        <button disabled={preferences.fontSize <= 15} onClick={() => onChange({ fontSize: Math.max(15, preferences.fontSize - 1) })}
          title="减小字号" aria-label="减小正文字号"><span aria-hidden="true">A</span><Minus size={12} aria-hidden="true" /></button>
        <button disabled={preferences.fontSize >= 25} onClick={() => onChange({ fontSize: Math.min(25, preferences.fontSize + 1) })}
          title="增大字号" aria-label="增大正文字号"><span aria-hidden="true">A</span><Plus size={12} aria-hidden="true" /></button>
      </div>
    </div>
  </div>
}
