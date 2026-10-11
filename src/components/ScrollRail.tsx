import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

interface ScrollMetrics {
  position: number
  viewport: number
  total: number
  track: number
}

interface Props {
  getPane: () => HTMLDivElement | null
  controls: string
  label: string
}

const EMPTY_METRICS: ScrollMetrics = { position: 0, viewport: 0, total: 0, track: 0 }

/** A visible control for the native scrolling viewport, including on macOS overlay-scrollbar settings. */
export function ScrollRail({ getPane, controls, label }: Props) {
  const rail = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; y: number; lastY: number; position: number } | null>(null)
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const [dragging, setDragging] = useState(false)
  const maximum = Math.max(0, metrics.total - metrics.viewport)
  const thumbHeight = Math.min(metrics.track, Math.max(28, metrics.total ? metrics.viewport / metrics.total * metrics.track : metrics.track))
  const travel = Math.max(0, metrics.track - thumbHeight)
  const thumbTop = maximum > 0 ? Math.max(0, Math.min(travel, metrics.position / maximum * travel)) : 0
  const scrollable = maximum > 1 && travel > 0
  const percent = maximum ? Math.round(metrics.position / maximum * 100) : 0

  useLayoutEffect(() => {
    const current = drag.current
    const pane = getPane()
    if (current && pane) {
      // Header folding changes the track length during a drag; continue from the current pointer and anchor.
      current.y = current.lastY
      current.position = pane.scrollTop
    }
  }, [metrics.viewport, metrics.total, metrics.track, getPane])

  useLayoutEffect(() => {
    const pane = getPane()
    const track = rail.current
    if (!pane || !track) return
    const update = () => {
      const next = { position: pane.scrollTop, viewport: pane.clientHeight, total: pane.scrollHeight, track: track.clientHeight }
      setMetrics((previous) => Object.keys(next).every((key) => next[key as keyof ScrollMetrics] === previous[key as keyof ScrollMetrics]) ? previous : next)
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? pane.clientHeight : 1
      pane.scrollTop += event.deltaY * unit
    }
    update()
    pane.addEventListener('scroll', update, { passive: true })
    track.addEventListener('wheel', wheel, { passive: false })
    const observer = new ResizeObserver(update)
    observer.observe(pane)
    observer.observe(track)
    const content = pane.querySelector('.paper-content')
    if (content) observer.observe(content)
    return () => {
      pane.removeEventListener('scroll', update)
      track.removeEventListener('wheel', wheel)
      observer.disconnect()
    }
  }, [getPane])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const pane = getPane()
    if (event.button !== 0 || !pane || !scrollable) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    if (!(event.target instanceof Element && event.target.closest('.scroll-thumb'))) {
      const offset = event.clientY - event.currentTarget.getBoundingClientRect().top - thumbHeight / 2
      pane.scrollTop = Math.max(0, Math.min(travel, offset)) / travel * maximum
    }
    drag.current = { pointerId: event.pointerId, y: event.clientY, lastY: event.clientY, position: pane.scrollTop }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const pane = getPane()
    const current = drag.current
    if (!pane || !current || current.pointerId !== event.pointerId || !travel) return
    current.lastY = event.clientY
    pane.scrollTop = Math.max(0, Math.min(maximum, current.position + (event.clientY - current.y) / travel * maximum))
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const pane = getPane()
    if (!pane) return
    let next = pane.scrollTop
    if (event.key === 'ArrowDown') next += 40
    else if (event.key === 'ArrowUp') next -= 40
    else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) next += pane.clientHeight * .9
    else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) next -= pane.clientHeight * .9
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = maximum
    else return
    event.preventDefault()
    pane.scrollTop = Math.max(0, Math.min(maximum, next))
  }

  return <div ref={rail} className={`scroll-rail ${dragging ? 'is-dragging' : ''} ${scrollable ? '' : 'is-inactive'}`}
    role="scrollbar" aria-label={label} aria-controls={controls} aria-orientation="vertical"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%`}
    aria-hidden={!scrollable ? true : undefined} tabIndex={scrollable ? 0 : -1}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag}
    onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onKeyDown={onKeyDown}>
    <div className="scroll-thumb" style={{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }} />
  </div>
}
