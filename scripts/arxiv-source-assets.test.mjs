import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { gzipSync } from 'node:zlib'
import { sha256, sanitizeSvg } from './paper-lib.mjs'
import { importArxiv } from './import-paper.mjs'
import { extractTarAsset, readArxivSourceAssetRecovery, recoverArxivSourceAsset } from './arxiv-source-assets.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const fixedVersion = '2005.14165v4'
const member = 'graphs/scale_plots/superglue_--_boolq.png'
const imageUrl = `https://arxiv.org/html/${fixedVersion}/${member}`

function tarArchive(entries) {
  const chunks = []
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? png)
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100, 'utf8')
    header.write('0000644\0', 100, 8, 'ascii')
    header.write('0000000\0', 108, 8, 'ascii')
    header.write('0000000\0', 116, 8, 'ascii')
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
    header.write('00000000000\0', 136, 12, 'ascii')
    header.fill(32, 148, 156)
    header.write(entry.type ?? '0', 156, 1, 'ascii')
    header.write('ustar\0', 257, 6, 'ascii')
    header.write('00', 263, 2, 'ascii')
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'papero-arxiv-assets-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('recovers exact fixed-version archive members and records their original bytes and provenance', async t => {
  const directory = await workspace(t)
  const secondMember = 'graphs/scale_plots/superglue_--_rte.png'
  const archive = tarArchive([{ name: `./${member}` }, { name: secondMember }])
  let requests = 0
  const fetchImpl = async url => {
    requests++
    assert.equal(url, `https://arxiv.org/src/${fixedVersion}`)
    return new Response(archive, { headers: { 'content-type': 'application/gzip' } })
  }
  const first = await recoverArxivSourceAsset({ directory, arxivId: fixedVersion, url: imageUrl, status: 404, fetchImpl })
  assert.deepEqual(first.bytes, png)
  assert.equal(first.recovery.archiveSha256, sha256(archive))
  assert.equal(first.recovery.assetSha256, sha256(png))
  assert.equal(first.recovery.archiveMember, member)
  assert.equal(first.recovery.requestedUrl, imageUrl)
  assert.deepEqual(first.recovery.tool.parameters, { compression: 'gzip', format: 'tar', member })
  const second = await recoverArxivSourceAsset({ directory, arxivId: fixedVersion, url: `https://arxiv.org/html/${fixedVersion}/${secondMember}`, status: 410, fetchImpl })
  assert.deepEqual(second.bytes, png)
  assert.equal(requests, 1)
  assert.deepEqual(await readArxivSourceAssetRecovery({ directory, arxivId: fixedVersion, url: imageUrl, bytes: png }), first.recovery)
})

test('fails for missing, differently named, or symbolic-link archive members', () => {
  assert.throws(() => extractTarAsset(tarArchive([{ name: 'other/boolq.png' }]), member), /Exact asset member is absent/)
  assert.throws(() => extractTarAsset(tarArchive([{ name: member, type: '2' }]), member), /not a regular file/)
  const corrupted = tarArchive([{ name: member }])
  const bad = Buffer.from(corrupted)
  bad[bad.length - 6] ^= 1
  assert.throws(() => extractTarAsset(bad, member))
})

test('limits recovery to missing official assets at an exact fixed version', async t => {
  const directory = await workspace(t)
  const fetchImpl = async () => { throw new Error('Unexpected network request') }
  for (const changes of [
    { status: 500 }, { arxivId: '2005.14165' },
    { url: `https://example.com/html/${fixedVersion}/${member}` },
    { url: `https://arxiv.org/html/2005.14165v3/${member}` },
    { url: `https://arxiv.org/html/${fixedVersion}/graphs/%2E%2E%2Fsecret.png` },
    { url: `${imageUrl}?redirect=other` },
  ]) {
    await assert.rejects(recoverArxivSourceAsset({ directory, arxivId: fixedVersion, url: imageUrl, status: 404, fetchImpl, ...changes }))
  }
})

test('rejects HTML masquerading as an image, and detects stale cached archive or recovered asset bytes', async t => {
  const directory = await workspace(t)
  const nonImage = tarArchive([{ name: member, body: '<html>missing</html>' }])
  await assert.rejects(recoverArxivSourceAsset({ directory, arxivId: fixedVersion, url: imageUrl, status: 404, fetchImpl: async () => new Response(nonImage) }), /not the requested image format/)
  const archive = tarArchive([{ name: member }])
  await recoverArxivSourceAsset({ directory, arxivId: fixedVersion, url: imageUrl, status: 404, fetchImpl: async () => new Response(archive) })
  await assert.rejects(readArxivSourceAssetRecovery({ directory, arxivId: fixedVersion, url: imageUrl, bytes: Buffer.concat([png, Buffer.from('stale')]) }), /recovery fingerprint mismatch/)
  const metadataPath = path.join(directory, 'source-archive.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  metadata.sha256 = '0'.repeat(64)
  await writeFile(metadataPath, JSON.stringify(metadata))
  await assert.rejects(readArxivSourceAssetRecovery({ directory, arxivId: fixedVersion, url: imageUrl, bytes: png }), /archive fingerprint or identity mismatch/)
})

test('reimport validates recovered SVG original bytes separately from sanitized publication bytes', async t => {
  const directory = await workspace(t)
  const svgMember = 'figures/chart.svg'
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>'
  const archive = tarArchive([{ name: svgMember, body: svg }])
  const html = `<div id="watermark-tr">arXiv:${fixedVersion}</div><article class="ltx_document"><h1 class="ltx_title ltx_title_document">SVG recovery</h1><section id="S1"><h2 class="ltx_title">Chart</h2><figure id="F1"><img src="${fixedVersion}/${svgMember}"><figcaption>Chart of model performance.</figcaption></figure></section></article>`
  const previousFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async url => {
    requests++
    if (String(url) === `https://arxiv.org/html/${fixedVersion}`) return new Response(html, { headers: { 'content-type': 'text/html' } })
    if (String(url) === `https://arxiv.org/html/${fixedVersion}/${svgMember}`) return new Response('', { status: 404 })
    if (String(url) === `https://arxiv.org/src/${fixedVersion}`) return new Response(archive)
    throw new Error(`Unexpected network request: ${url}`)
  }
  t.after(() => { globalThis.fetch = previousFetch })
  const options = { dataDir: directory, id: 'svg-recovery', arxivId: fixedVersion }
  const first = await importArxiv(options)
  const asset = first.assets[0]
  assert.equal(asset.sourceSha256, sha256(svg))
  assert.equal(asset.sha256, sha256(sanitizeSvg(svg)))
  assert.notEqual(asset.sha256, asset.sourceSha256)
  const second = await importArxiv(options)
  assert.deepEqual(second.assets, first.assets)
  assert.equal(requests, 3)
  const cachedAsset = path.join(directory, 'papers', options.id, 'assets', 'chart.svg')
  await writeFile(cachedAsset, '<svg><rect width="20"/></svg>')
  await assert.rejects(importArxiv(options), /sanitized SVG fingerprint mismatch/)
  assert.equal(requests, 3)
})
