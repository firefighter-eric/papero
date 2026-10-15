/** Self-contained: the same trusted runtime powers the reader and offline HTML. */
export function createResearchVisualRuntime() {
  const kinds = ['optimizer-trajectory', 'layer-trust', 'matrix-spectrum']
  const names = ['SGD', 'Momentum', 'AdamW', 'LAMB']
  const fmt = n => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '超出范围'
  function trajectory({ curvature = 12, learningRate = 0.05, momentum = 0.8, steps = 40 } = {}) {
    return names.map(name => {
      let w = [3, 3], velocity = [0, 0], m = [0, 0], v = [0, 0], stopped = false
      const points = [{ x: 3, y: 3, loss: (curvature * 9 + 9) / 2 }]
      for (let t = 1; t <= steps; t++) {
        const g = [curvature * w[0], w[1]]
        let update = g
        if (name === 'Momentum') {
          velocity = g.map((value, i) => momentum * velocity[i] + value)
          update = velocity
        } else if (name === 'AdamW' || name === 'LAMB') {
          m = g.map((value, i) => 0.9 * m[i] + 0.1 * value)
          v = g.map((value, i) => 0.999 * v[i] + 0.001 * value * value)
          update = m.map((value, i) => value / (1 - 0.9 ** t) / (Math.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8))
          if (name === 'LAMB') {
            const norm = Math.hypot(...update)
            const ratio = norm > 0 && Math.hypot(...w) > 0 ? Math.hypot(...w) / norm : 1
            update = update.map(value => value * ratio)
          }
        }
        w = w.map((value, i) => value - learningRate * update[i])
        // Bound the display, not the optimizer; never clamp a divergent trajectory.
        if (w.some(value => !Number.isFinite(value) || Math.abs(value) > 12)) { stopped = true; break }
        points.push({ x: w[0], y: w[1], loss: (curvature * w[0] ** 2 + w[1] ** 2) / 2 })
      }
      return { name, points, stopped }
    })
  }
  function layerTrust({ largeWeight = 20, update = 1, learningRate = 0.02, decay = 0, capped = false } = {}) {
    return [1, largeWeight].map(weight => {
      const candidate = update + decay * weight
      const phi = capped ? Math.min(weight, 5) : weight
      const ratio = candidate > 0 ? phi / candidate : 1
      return { weight, candidate, ratio, adamRelative: learningRate * candidate / weight,
        lambRelative: learningRate * ratio * candidate / weight }
    })
  }
  function spectrum({ large = 8, small = 0.4, steps = 5, method = 'jordan' } = {}) {
    const norm = Math.hypot(large, small)
    let values = [large / norm, small / norm]
    for (let i = 0; i < steps; i++) values = values.map(x => method === 'classical'
      ? 1.5 * x - 0.5 * x ** 3 : 3.4445 * x - 4.775 * x ** 3 + 2.0315 * x ** 5)
    // B = R(30°) diag(σ₁,σ₂) R(-20°)ᵀ, known SVD by construction.
    const matrix = ([a, b]) => {
      const l = Math.PI / 6, r = -Math.PI / 9
      const c = Math.cos(l), s = Math.sin(l), d = Math.cos(r), t = Math.sin(r)
      return [c * a * d + s * b * t, c * a * t - s * b * d,
        s * a * d - c * b * t, s * a * t + c * b * d]
    }
    return { original: [large, small], approximate: values, ideal: [1, 1],
      matrices: [[large, small], values, [1, 1]].map(matrix),
      error: Math.max(...values.map(x => Math.abs(x - 1))) }
  }
  function mount(root) {
    const doc = root.ownerDocument ?? root
    const cleanups = []
    const node = (tag, attrs = {}, text) => {
      const n = doc.createElement(tag)
      for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value))
      if (text !== undefined) n.textContent = text
      return n
    }
    const svgNode = (tag, attrs = {}, text) => {
      const n = doc.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value))
      if (text !== undefined) n.textContent = text
      return n
    }
    const add = (parent, ...children) => { parent.append(...children); return parent }
    for (const [index, figure] of [...root.querySelectorAll('figure[data-research-visual]')].entries()) {
      const kind = figure.getAttribute('data-research-visual')
      const host = figure.querySelector('[data-visual-mount]')
      if (!kinds.includes(kind) || !host || host.dataset.mounted) continue
      const original = [...host.childNodes]
      const panel = node('div', { class: 'rv-panel' })
      const controls = node('div', { class: 'rv-controls' })
      const chart = node('div', { class: 'rv-chart' })
      const metrics = node('div', { class: 'rv-metrics', 'aria-live': 'polite', 'aria-atomic': 'true' })
      const inputs = {}, outputs = {}, defaults = {}
      const listeners = []
      const listen = (el, type, fn) => { el.addEventListener(type, fn); listeners.push(() => el.removeEventListener(type, fn)) }
      const prefix = `${figure.id || 'visual'}-${index}`
      const range = (key, label, min, max, step, value) => {
        const id = `${prefix}-${key}`, input = node('input', { type: 'range', id, min, max, step, value })
        const output = node('output', { for: id })
        const head = add(node('span', { class: 'rv-control-heading' }), node('span', {}, label), output)
        controls.append(add(node('label', { for: id, class: 'rv-control' }), head, input))
        inputs[key] = input; outputs[key] = output; defaults[key] = String(value)
      }
      const select = (key, label, options, value) => {
        const id = `${prefix}-${key}`, input = node('select', { id })
        for (const [value, label] of options) input.append(node('option', { value }, label))
        input.value = value; inputs[key] = input; defaults[key] = value
        controls.append(add(node('label', { for: id, class: 'rv-control' }), node('span', {}, label), input))
      }
      const note = node('p', { class: 'rv-note' })
      if (kind === 'optimizer-trajectory') {
        range('curvature', '曲率差 a', 1, 30, 1, 12)
        range('learningRate', '学习率 η', 0.005, 0.25, 0.005, 0.05)
        range('momentum', 'Momentum 系数 μ', 0, 0.95, 0.05, 0.8)
        range('steps', '更新步数', 1, 100, 1, 40)
        note.textContent = '合成二维函数 L=(a·x²+y²)/2，从 (3,3) 出发；无衰减。AdamW/LAMB 使用 β=(0.9,0.999)、ε=10⁻⁸；LAMB 将两个坐标视为一个块。相同数值学习率只用于观察行为，不代表公平调参或性能排名。超出 ±12 的轨迹停止显示，不修改更新值。'
      } else if (kind === 'layer-trust') {
        range('largeWeight', '大层权重范数', 2, 50, 1, 20)
        range('update', '两层的自适应更新幅度', 0.1, 4, 0.1, 1)
        range('learningRate', '学习率 η', 0.005, 0.1, 0.005, 0.02)
        range('decay', '衰减系数 λ', 0, 0.3, 0.01, 0)
        select('capped', '范数缩放 φ(w)', [['false', '不截断：φ(w)=w'], ['true', '上限为 5：φ(w)=min(w,5)']], 'false')
        note.textContent = '每层简化为一个正标量：小层权重=1，自适应方向与权重同向；d=u+λw，LAMB 比率=φ(w)/|d|。图中比较 |Δw|/|w|，不是损失或准确率。零范数及真实多维层不在本演示中。'
      } else {
        range('large', '较大奇异值 σ₁', 2, 12, 0.5, 8)
        range('small', '较小奇异值 σ₂', 0.05, 2, 0.05, 0.4)
        range('steps', '多项式迭代步数', 0, 10, 1, 5)
        select('method', '近似方法', [['jordan', 'Jordan 快速五次多项式'], ['classical', '经典三次 Newton–Schulz']], 'jordan')
        note.textContent = '构造 B=R(30°)·diag(σ₁,σ₂)·R(−20°)ᵀ，先按 Frobenius 范数归一化；在精确算术中对奇异值应用多项式。未模拟 bf16 舍入、动量或训练收益。Jordan 系数优先少步近似，增加步数不保证收敛至 1；五次多项式与五步迭代是两个概念。'
      }
      const reset = node('button', { type: 'button', class: 'rv-reset' }, '恢复默认')
      const head = add(node('div', { class: 'rv-topline' }), node('span', { class: 'rv-badge' }, '可交互 · 合成原理演示'), reset)
      add(panel, head, controls, chart, metrics, note)
      host.replaceChildren(panel); host.dataset.mounted = 'true'; figure.classList.add('research-visual')
      const makeSvg = (height, label) => add(svgNode('svg', { viewBox: `0 0 640 ${height}`, role: 'img', 'aria-label': label, class: 'rv-svg' }), svgNode('title', {}, label))
      const text = (svg, x, y, value, extra = {}) => svg.append(svgNode('text', { x, y, ...extra }, value))
      const line = (svg, x1, y1, x2, y2, extra = {}) => svg.append(svgNode('line', { x1, y1, x2, y2, class: 'rv-axis', ...extra }))
      const metricTable = (headers, rows) => {
        const table = node('table', { class: 'rv-table' })
        const caption = node('caption', { class: 'rv-sr-only' }, '当前参数下的计算结果')
        const thead = node('thead'), tr = node('tr')
        for (const title of headers) tr.append(node('th', { scope: 'col' }, title))
        thead.append(tr)
        const tbody = node('tbody')
        for (const cells of rows) { const row = node('tr'); for (const cell of cells) row.append(node('td', {}, String(cell))); tbody.append(row) }
        table.append(caption, thead, tbody); metrics.replaceChildren(table)
      }
      function draw() {
        const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key,
          input.tagName === 'SELECT' ? (key === 'capped' ? input.value === 'true' : input.value) : Number(input.value)]))
        for (const key of Object.keys(outputs)) outputs[key].textContent = fmt(values[key])
        if (kind === 'optimizer-trajectory') {
          const series = trajectory(values)
          const bound = Math.max(3.6, ...series.flatMap(s => s.points.flatMap(p => [Math.abs(p.x) * 1.1, Math.abs(p.y) * 1.1])))
          const sx = x => 320 + x / bound * 260, sy = y => 175 - y / bound * 145
          const svg = makeSvg(380, '二维二次损失函数上的四种更新轨迹；起点 (3,3)，最小值 (0,0)')
          for (const loss of [1, 4, 12, 30, 70]) {
            const points = Array.from({ length: 97 }, (_, i) => {
              const a = i / 96 * Math.PI * 2
              return `${sx(Math.sqrt(2 * loss / values.curvature) * Math.cos(a)).toFixed(2)},${sy(Math.sqrt(2 * loss) * Math.sin(a)).toFixed(2)}`
            })
            // Contours outside the plot are omitted, not allowed to overlap labels.
            if (Math.sqrt(2 * loss) <= bound) svg.append(svgNode('polyline', { points: points.join(' '), class: 'rv-contour' }))
          }
          line(svg, 50, sy(0), 590, sy(0)); line(svg, sx(0), 22, sx(0), 330)
          for (const value of [-bound / 2, 0, bound / 2]) {
            text(svg, sx(value), 347, fmt(value), { 'text-anchor': 'middle' })
            text(svg, 40, sy(value) + 4, fmt(value), { 'text-anchor': 'end' })
          }
          text(svg, 600, sy(0) - 10, 'x'); text(svg, sx(0) + 10, 20, 'y')
          text(svg, sx(3) - 8, sy(3) - 10, '起点', { 'text-anchor': 'end' })
          const styles = ['', '8 4', '3 3', '10 3 2 3']
          series.forEach((s, i) => {
            const points = s.points.map(p => `${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join(' ')
            const path = svgNode('polyline', { points, fill: 'none', stroke: `var(--rv-${i + 1})`, 'stroke-width': 2.5, 'stroke-dasharray': styles[i], 'data-series': s.name })
            path.append(svgNode('title', {}, `${s.name}：${s.points.length - 1} 步，损失 ${fmt(s.points.at(-1).loss)}`)); svg.append(path)
            const p = s.points.at(-1), mark = svgNode('circle', { cx: sx(p.x), cy: sy(p.y), r: 4.5,
              fill: `var(--rv-${i + 1})`, tabindex: '0', 'aria-label': `${s.name} 终点 (${fmt(p.x)},${fmt(p.y)})，损失 ${fmt(p.loss)}` })
            mark.append(svgNode('title', {}, mark.getAttribute('aria-label'))); svg.append(mark)
            const x = 35 + i * 152
            line(svg, x, 371, x + 24, 371, { stroke: `var(--rv-${i + 1})`, 'stroke-dasharray': styles[i], 'stroke-width': 2.5, class: '' })
            text(svg, x + 30, 375, s.name)
          })
          chart.replaceChildren(svg)
          metricTable(['方法', '完成步数', '终点损失 L', '状态'], series.map(s => [s.name, s.points.length - 1, fmt(s.points.at(-1).loss), s.stopped ? '超出图示范围' : '已计算']))
        } else if (kind === 'layer-trust') {
          const layers = layerTrust(values)
          const maximum = Math.max(0.025, ...layers.flatMap(s => [s.adamRelative, s.lambRelative])) * 1.15
          const svg = makeSvg(270, '两层的相对更新幅度对照；水平轴为权重范数的百分比')
          text(svg, 175, 18, '相对更新幅度 |Δw|/|w|（%）')
          const rows = layers.flatMap((s, i) => [{ label: `层${i + 1} · AdamW`, value: s.adamRelative, color: 3 }, { label: `层${i + 1} · LAMB`, value: s.lambRelative, color: 4 }])
          rows.forEach((s, i) => {
            const y = 40 + i * 43, width = s.value / maximum * 350
            text(svg, 145, y + 17, s.label, { 'text-anchor': 'end' })
            const bar = svgNode('rect', { x: 165, y, width, height: 24, rx: 3, fill: `var(--rv-${s.color})` })
            bar.append(svgNode('title', {}, `${s.label}：${fmt(s.value * 100)}%`)); svg.append(bar)
            text(svg, 177 + width, y + 17, `${fmt(s.value * 100)}%`)
          })
          line(svg, 165, 221, 530, 221)
          for (let i = 0; i <= 4; i++) text(svg, 165 + i * 350 / 4, 243, fmt(maximum * i / 4 * 100), { 'text-anchor': 'middle' })
          chart.replaceChildren(svg)
          metricTable(['参数块', '权重范数', '候选更新 |d|', 'LAMB 比率 ρ'], layers.map((s, i) => [`层 ${i + 1}`, fmt(s.weight), fmt(s.candidate), fmt(s.ratio)]))
        } else {
          const result = spectrum(values), groups = [result.original, result.approximate, result.ideal]
          const labels = ['原动量 B', '迭代近似 Õ', '理想极因子 UVᵀ']
          const max = Math.max(...groups.flat(), 1) * 1.15
          const svg = makeSvg(340, '构造矩阵的两个奇异值：原动量、有限步迭代近似与理想极因子')
          text(svg, 22, 22, '奇异值（无量纲）')
          for (let i = 0; i <= 4; i++) {
            const y = 245 - i / 4 * 190
            line(svg, 52, y, 610, y, { class: 'rv-grid' }); text(svg, 44, y + 4, fmt(max * i / 4), { 'text-anchor': 'end' })
          }
          groups.forEach((pair, i) => {
            pair.forEach((value, j) => {
              const x = 98 + i * 185 + j * 52, height = value / max * 190
              const bar = svgNode('rect', { x, y: 245 - height, width: 32, height, rx: 2, fill: `var(--rv-${j + 1})`, opacity: j === 1 ? 0.7 : 1 })
              bar.append(svgNode('title', {}, `${labels[i]} σ${j + 1}=${fmt(value)}`)); svg.append(bar)
              text(svg, x + 16, 235 - height, fmt(value), { 'text-anchor': 'middle' })
              text(svg, x + 16, 265, `σ${j + 1}`, { 'text-anchor': 'middle' })
            })
            text(svg, 140 + i * 185, 291, labels[i], { 'text-anchor': 'middle' })
          })
          text(svg, 52, 327, `相对理想奇异值 1 的最大绝对误差：${fmt(result.error)}`)
          chart.replaceChildren(svg)
          metricTable(['矩阵（2×2）', '第一行', '第二行'], result.matrices.map((m, i) => [labels[i], `[${fmt(m[0])}, ${fmt(m[1])}]`, `[${fmt(m[2])}, ${fmt(m[3])}]`]))
        }
      }
      for (const input of Object.values(inputs)) listen(input, 'input', draw)
      listen(reset, 'click', () => { for (const [key, input] of Object.entries(inputs)) input.value = defaults[key]; draw() })
      draw()
      cleanups.push(() => { for (const off of listeners) off(); host.replaceChildren(...original); delete host.dataset.mounted; figure.classList.remove('research-visual') })
    }
    return () => { for (const cleanup of cleanups) cleanup() }
  }
  return { kinds, trajectory, layerTrust, spectrum, mount }
}
