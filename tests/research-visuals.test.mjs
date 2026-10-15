import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { createResearchVisualRuntime } from '../src/lib/research-visuals.mjs'
import { buildResearchDownload } from '../src/lib/research-download'

const runtime = createResearchVisualRuntime()
const markers = runtime.kinds.map((kind, i) => `<figure id="figure-${i}" data-research-visual="${kind}"><figcaption>原理图 ${i + 1}</figcaption><div data-visual-mount><p>默认状态下的静态内容</p></div></figure>`).join('')

describe('research visual calculations and offline runtime', () => {
  it('takes the stated gradient, momentum and bias-corrected adaptive steps', () => {
    const one = runtime.trajectory({ steps: 1 })
    expect(one[0].points[1].x).toBeCloseTo(1.2)
    expect(one[0].points[1].y).toBeCloseTo(2.85)
    expect(one[2].points[1].x).toBeCloseTo(2.95)
    expect(one[2].points[1].y).toBeCloseTo(2.95)
    expect(one[3].points[1].x).toBeCloseTo(2.85)
    expect(runtime.trajectory({ steps: 2 })[1].points[2].x).toBeCloseTo(-0.96)
    for (const series of runtime.trajectory()) for (const point of series.points) expect(point.loss).toBeCloseTo((12 * point.x ** 2 + point.y ** 2) / 2)
  })
  it('reports out-of-range trajectories without silently clipping their values', () => {
    const unstable = runtime.trajectory({ curvature: 30, learningRate: 0.25 })[0]
    expect(unstable.stopped).toBe(true)
    expect(unstable.points.length).toBeLessThan(41)
    expect(runtime.trajectory({ learningRate: 0.01 })[0].stopped).toBe(false)
  })
  it('matches LAMB relative steps only under the explicitly stated uncapped assumptions', () => {
    const layers = runtime.layerTrust({ decay: 0.1 })
    expect(layers[0].adamRelative).not.toBeCloseTo(layers[1].adamRelative)
    for (const layer of layers) expect(layer.lambRelative).toBeCloseTo(0.02)
    expect(layers[1].ratio).toBeCloseTo(20 / 3)
    expect(runtime.layerTrust({ capped: true })[1].lambRelative).toBeCloseTo(0.005)
  })
  it('constructs the known spectrum and orthogonal ideal factor without pretending to run arbitrary SVD', () => {
    const zero = runtime.spectrum({ steps: 0 })
    expect(zero.approximate[0]).toBeCloseTo(8 / Math.hypot(8, 0.4))
    const classical = runtime.spectrum({ steps: 1, method: 'classical' })
    expect(classical.approximate[1]).toBeCloseTo(1.5 * zero.approximate[1] - 0.5 * zero.approximate[1] ** 3)
    expect(runtime.spectrum({ steps: 8, method: 'classical' }).error).toBeLessThan(classical.error)
    const ideal = zero.matrices[2]
    expect(ideal[0] ** 2 + ideal[1] ** 2).toBeCloseTo(1)
    expect(ideal[0] * ideal[2] + ideal[1] * ideal[3]).toBeCloseTo(0)
    expect(zero.matrices[0].reduce((sum, v) => sum + v * v, 0)).toBeCloseTo(64.16)
  })
  it('updates SVG and numeric results, resets controls, and restores static content on cleanup', () => {
    const host = document.createElement('div'); host.innerHTML = markers; document.body.append(host)
    const cleanup = runtime.mount(host)
    expect(host.querySelectorAll('svg')).toHaveLength(3)
    const input = host.querySelector('input[id$="-learningRate"]')
    const chart = host.querySelector('.rv-chart'), before = chart.innerHTML
    input.value = '0.1'; input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(chart.innerHTML).not.toBe(before)
    expect(host.querySelector('output[for$="-learningRate"]').textContent).toBe('0.1')
    runtime.mount(host)()
    host.querySelector('.rv-reset').click()
    expect(input.value).toBe('0.05')
    cleanup()
    expect(host.querySelector('input')).toBeNull()
    expect(host.textContent).toContain('默认状态下的静态内容')
    host.remove()
  })
  it('exports a self-contained working document using only trusted JavaScript', () => {
    const report = { id: 'demo-report', title: '原理 <图>', dataPath: 'research/demo-report/report.json', html: `${markers}<script>window.UNTRUSTED=true</script><p onclick="window.UNTRUSTED=true">正文</p>` }
    const html = buildResearchDownload(report)
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    expect(dom.window.UNTRUSTED).toBeUndefined()
    expect(dom.window.document.title).toBe('原理 <图>')
    expect(dom.window.document.querySelectorAll('svg')).toHaveLength(3)
    expect(dom.window.document.querySelectorAll('script')).toHaveLength(1)
    expect(dom.window.document.querySelector('[onclick]')).toBeNull()
    expect(dom.window.document.querySelector('script[src],link[rel="stylesheet"]')).toBeNull()
    const input = dom.window.document.querySelector('input[id$="-largeWeight"]')
    input.value = '40'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(dom.window.document.querySelector('output[for$="-largeWeight"]').textContent).toBe('40')
    dom.window.close()
  })
  it('does not run unsupported visual markers', () => {
    const host = document.createElement('div')
    host.innerHTML = '<figure data-research-visual="external-code"><div data-visual-mount></div></figure>'
    const cleanup = runtime.mount(host)
    expect(host.querySelector('svg')).toBeNull()
    cleanup()
  })
})
