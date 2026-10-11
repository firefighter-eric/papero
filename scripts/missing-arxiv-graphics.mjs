import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { extractTarAsset } from './arxiv-source-assets.mjs'
import { sha256 } from './paper-lib.mjs'

const run = promisify(execFile)
const profiles = {
  '2505.16932v5': {
    sourceSha256: 'd42a281e02bf42578bd33cbbdeb50b6cfcbb123dbfdfc8b7f77d30671e8d2216',
    archiveSha256: 'b059c046d915c7fe13b1736e874a25db95b66e1394f4efc7548923948e998ecb',
    graphics: [{ id: 'A8.F13.sf2.g2', filename: 'recovered-A8-F13-sf2-g2.png',
      member: 'img/revisions-noah-polar-branch/10b_data_small/10b_data_small-nl-12-wd-0.0.pdf',
      pdfSha256: 'ef82ad7ebe4da610c626454f02f1479d884a78c5cfbdc432c29a5b6655cd7dd3' }],
  },
}

async function renderPdf(pdfFile, outputPrefix) {
  const version = await run('pdftoppm', ['-v'])
  const toolVersion = `${version.stdout}${version.stderr}`.match(/pdftoppm version ([^\s]+)/)?.[1]
  if (!toolVersion) throw new Error('Cannot identify PDF figure renderer')
  await run('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-png', '-scale-to', '1200', pdfFile, outputPrefix])
  return { bytes: await readFile(`${outputPrefix}.png`), version: toolVersion }
}

/** Restore a verified missing figure from the same pinned version's original source. */
export async function recoverMissingArxivGraphics({ $, arxivId, sourceSha256, directory, fetchImpl = fetch, renderer = renderPdf }) {
  const missing = $('article img').toArray().filter(node => !$(node).attr('src'))
  if (!missing.length) return { assets: [], repairs: [] }
  const profile = profiles[arxivId]
  if (!profile || profile.sourceSha256 !== sourceSha256 || missing.length !== profile.graphics.length
    || missing.some(node => !profile.graphics.some(g => g.id === $(node).attr('id')))) {
    throw new Error(`Unverified missing graphic in fixed arXiv HTML: ${arxivId}`)
  }
  const archiveUrl = `https://arxiv.org/src/${arxivId}`
  const archiveFile = path.join(directory, 'missing-graphics-source.tar.gz')
  let archive
  try { archive = await readFile(archiveFile) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const response = await fetchImpl(archiveUrl, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error(`Missing graphic source archive request failed: ${response.status}`)
    archive = Buffer.from(await response.arrayBuffer())
  }
  if (archive.length > 64 * 1024 * 1024 || sha256(archive) !== profile.archiveSha256) throw new Error('Missing graphic source archive fingerprint mismatch')
  await mkdir(path.join(directory, 'source-assets'), { recursive: true })
  await writeFile(archiveFile, archive)
  const assets = [], repairs = []
  for (const graphic of profile.graphics) {
    const pdf = extractTarAsset(archive, graphic.member)
    if (sha256(pdf) !== graphic.pdfSha256 || !pdf.subarray(0, 8).toString().startsWith('%PDF-')) throw new Error('Missing graphic PDF source fingerprint mismatch')
    const pdfFile = path.join(directory, 'source-assets', `${graphic.filename}.pdf`)
    await writeFile(pdfFile, pdf)
    const outputPrefix = path.join(directory, 'source-assets', graphic.filename.replace(/\.png$/, ''))
    const { bytes, version } = await renderer(pdfFile, outputPrefix)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Recovered graphic renderer did not return PNG')
    await writeFile(path.join(directory, 'assets', graphic.filename), bytes)
    const recovery = { method: 'pinned-arxiv-source-pdf-figure', sourceId: graphic.id, archiveUrl,
      archiveSha256: profile.archiveSha256, archiveMember: graphic.member, sourcePdfSha256: graphic.pdfSha256,
      assetSha256: sha256(bytes), tool: { name: 'pdftoppm', version, parameters: { page: 1, format: 'png', scaleTo: 1200 } } }
    assets.push({ filename: graphic.filename, sourceUrl: archiveUrl, sha256: sha256(bytes), bytes: bytes.length, recovery })
    repairs.push(recovery)
    const node = missing.find(n => $(n).attr('id') === graphic.id)
    $(node).attr('src', `assets/${graphic.filename}`).removeClass('ltx_missing ltx_missing_image')
  }
  return { assets, repairs }
}
