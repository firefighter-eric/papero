import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createHash, webcrypto } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadResearchCatalog, loadResearchDocument } from '../src/lib/research-data'
import { resolvePaperDataUrl } from '../src/lib/paper-data'
import { prepareData } from '../scripts/prepare-data.mjs'
import { inspectResearchData } from '../scripts/research-data.mjs'

const root = path.resolve('paper-data')
const catalog = JSON.parse(await readFile(path.join(root, 'research/catalog.json'), 'utf8'))
const entry = catalog.reports.find(report => report.id === 'vision-pretraining-survey')
const metadata = JSON.parse(await readFile(path.join(root, entry.dataPath), 'utf8'))
const html = await readFile(path.join(root, entry.dataPath.replace('report.json', 'zh.html')), 'utf8')
function fixture(body = html) {
  const report = { ...metadata, content: { path: 'zh.html', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') } }
  const fetcher = vi.fn(async url => new Response(String(url).endsWith('report.json') ? JSON.stringify(report) : body))
  return { report, fetcher }
}

describe('separate research publications', () => {
  it('loads the complete cited Chinese HTML without treating it as a translation', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { fetcher } = fixture()
    const report = await loadResearchDocument(entry, { baseUrl: 'https://papers.example/data', fetcher })
    expect(report.sections).toEqual(metadata.sections)
    expect(report.sources).toEqual(metadata.sources)
    expect(report.html).toContain('ref-R19')
    expect(report.html).toContain('TL;DR')
    expect(report.authorship.humanReviewed).toBe(false)
    expect(fetcher.mock.calls.map(c => String(c[0]))).toEqual([
      'https://papers.example/data/research/vision-pretraining-survey/report.json',
      'https://papers.example/data/research/vision-pretraining-survey/zh.html',
    ])
    vi.unstubAllGlobals()
  })
  it('rejects mixed metadata/body versions and broken citation destinations', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const corrupt = fixture()
    corrupt.fetcher.mockImplementation(async url => new Response(String(url).endsWith('report.json') ? JSON.stringify(metadata) : html + 'changed'))
    await expect(loadResearchDocument(entry, { fetcher: corrupt.fetcher })).rejects.toThrow('指纹')
    const broken = fixture(html.replace('href="#ref-R01"', 'href="#ref-R99"'))
    await expect(loadResearchDocument(entry, { fetcher: broken.fetcher })).rejects.toThrow('内部引用')
    vi.unstubAllGlobals()
  })
  it('sanitizes an HTML body even if its fingerprint has been updated', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const hostile = fixture(html.replace('</article>', '<script>alert(1)</script><p onclick="alert(1)">unsafe</p></article>'))
    const report = await loadResearchDocument(entry, { fetcher: hostile.fetcher })
    expect(report.html).not.toContain('<script')
    expect(report.html).not.toContain('onclick')
    vi.unstubAllGlobals()
  })
  it('allows old hosts with no research catalog, but rejects a malformed catalog', async () => {
    expect((await loadResearchCatalog({ fetcher: vi.fn(async () => new Response('', { status: 404 })) })).reports).toEqual([])
    await expect(loadResearchCatalog({ fetcher: vi.fn(async () => new Response('{"schemaVersion":1,"reports":[{}]}')) })).rejects.toThrow('研究数据无效')
  })
  it('keeps registered declarative figures while rejecting unknown or malformed visual markers', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const figure = '<figure id="demo-visual" data-research-visual="layer-trust"><figcaption>逐层步长演示</figcaption><div data-visual-mount><p>默认值</p></div></figure>'
    const { fetcher } = fixture(html.replace('</article>', `${figure}</article>`))
    const report = await loadResearchDocument(entry, { fetcher })
    expect(report.html).toContain('data-research-visual="layer-trust"')
    expect(report.html).not.toContain('<script')
    for (const bad of [figure.replace('layer-trust', 'arbitrary-script'), figure.replace('data-visual-mount', 'data-invalid')]) {
      await expect(loadResearchDocument(entry, { fetcher: fixture(html.replace('</article>', `${bad}</article>`)).fetcher })).rejects.toThrow('图示标记')
    }
    vi.unstubAllGlobals()
  })
  it('limits research URLs to the published catalog, metadata and Chinese body', () => {
    expect(resolvePaperDataUrl(entry.dataPath, 'https://papers.example/data')).toContain('/research/')
    for (const p of ['research/../catalog.json', 'research/%2e%2e/catalog.json', 'research/vision-pretraining-survey/source.html', 'research/vision-pretraining-survey/zh.html?token=x']) {
      expect(() => resolvePaperDataUrl(p)).toThrow()
    }
  })
  it('exports verified reports and excludes source snapshots; rejects unregistered links', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'papero-research-'))
    try {
      const data = path.join(temporary, 'data')
      const reportDir = path.join(data, 'research', entry.id)
      await mkdir(reportDir, { recursive: true })
      await writeFile(path.join(data, 'catalog.json'), '{"schemaVersion":1,"papers":[]}')
      await writeFile(path.join(data, 'research/catalog.json'), JSON.stringify({ ...catalog, reports: [entry] }))
      await writeFile(path.join(reportDir, 'report.json'), JSON.stringify(metadata))
      await writeFile(path.join(reportDir, 'zh.html'), html)
      await writeFile(path.join(reportDir, 'source.html'), 'private snapshot')
      const result = await prepareData({ dataDir: data, outDir: path.join(temporary, 'out'), include: true })
      expect(await readFile(path.join(result.output, entry.dataPath.replace('report.json', 'zh.html')), 'utf8')).toBe(html)
      await expect(readFile(path.join(result.output, 'research', entry.id, 'source.html'))).rejects.toThrow()
      const hostile = fixture(html.replace('href="#ref-R01"', 'href="https://unregistered.example/"'))
      await writeFile(path.join(reportDir, 'report.json'), JSON.stringify(hostile.report))
      await writeFile(path.join(reportDir, 'zh.html'), html.replace('href="#ref-R01"', 'href="https://unregistered.example/"'))
      await expect(inspectResearchData(data)).rejects.toThrow('Unregistered research link')
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
})
