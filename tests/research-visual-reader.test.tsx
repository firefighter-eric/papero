import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ResearchReader } from '../src/components/ResearchReader'
import type { ResearchDocument } from '../src/types'

it('keeps interactive state through reading progress and font changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const report = { id:'visual-demo', revision:1, sections:[{id:'section-one',title:'Section',level:1}],
    html:'<h2 id="section-one">Section</h2><figure id="figure-one" data-research-visual="layer-trust"><figcaption>逐层尺度</figcaption><div data-visual-mount>默认说明</div></figure>' } as ResearchDocument & { html: string }
  const onPosition = vi.fn()
  try {
    await act(async () => root.render(<ResearchReader report={report} fontSize={19} onPosition={onPosition} />))
    const input = host.querySelector<HTMLInputElement>('input[id$="-largeWeight"]')!
    await act(async () => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles:true })) })
    await act(async () => root.render(<ResearchReader report={{ ...report }} fontSize={20} onPosition={onPosition} />))
    expect(host.querySelector<HTMLInputElement>('input[id$="-largeWeight"]')?.value).toBe('40')
    expect(host.querySelectorAll('svg')).toHaveLength(1)
    expect(onPosition).toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove(); vi.unstubAllGlobals()
  }
})
