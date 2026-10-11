import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

interface Props {
  label: string
  controls: string
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (value: number) => void
}

export function SidebarResizeHandle({ label, controls, value, min, max, defaultValue, onChange }: Props) {
  const instructions = useId()
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: value }
    setDragging(true)
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== drag.current?.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10
    let next: number
    if (event.key === 'ArrowLeft') next = value - step
    else if (event.key === 'ArrowRight') next = value + step
    else if (event.key === 'Home') next = defaultValue
    else if (event.key === 'End') next = max
    else return
    event.preventDefault()
    onChange(Math.max(min, Math.min(max, next)))
  }

  return <div className={`sidebar-resize-handle${dragging ? ' is-dragging' : ''}`} role="separator" tabIndex={0}
    aria-label={label} aria-controls={controls} aria-orientation="vertical" aria-valuemin={min}
    aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} 像素`} aria-describedby={instructions}
    title="拖动调节宽度；双击恢复默认" onKeyDown={keyboard}
    onDoubleClick={() => onChange(defaultValue)} onPointerDown={start}
    onPointerMove={event => {
      const current = drag.current
      if (current?.pointerId === event.pointerId) onChange(Math.max(min, Math.min(max, current.startWidth + event.clientX - current.startX)))
    }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setDragging(false) }}>
    <span id={instructions} className="sr-only">拖动调节宽度，左右方向键微调，按住 Shift 加快，Home 或双击恢复默认。</span>
  </div>
}
