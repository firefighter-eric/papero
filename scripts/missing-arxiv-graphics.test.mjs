import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { load } from 'cheerio'
import { recoverMissingArxivGraphics } from './missing-arxiv-graphics.mjs'

const sourceSha256 = 'd42a281e02bf42578bd33cbbdeb50b6cfcbb123dbfdfc8b7f77d30671e8d2216'
const fixture = id => load(`<article><img id="${id}" src=""></article>`)
const noFetch = () => { throw new Error('Network must not be reached') }

test('ordinary HTML keeps its original graphic without requesting recovery', async () => {
  const $ = load('<article><img id="existing" src="assets/original.png"></article>')
  assert.deepEqual(await recoverMissingArxivGraphics({ $, arxivId: '2505.16932v5', sourceSha256, fetchImpl: noFetch }), { assets: [], repairs: [] })
  assert.equal($('img').attr('src'), 'assets/original.png')
})

test('missing images from unknown versions or changed source snapshots are rejected before any mutation', async () => {
  for (const [arxivId, fingerprint, id] of [
    ['2505.16932v4', sourceSha256, 'A8.F13.sf2.g2'],
    ['2505.16932v5', 'a'.repeat(64), 'A8.F13.sf2.g2'],
    ['2505.16932v5', sourceSha256, 'unknown-id'],
  ]) {
    const $ = fixture(id)
    await assert.rejects(recoverMissingArxivGraphics({ $, arxivId, sourceSha256: fingerprint, fetchImpl: noFetch }), /Unverified missing graphic/)
    assert.equal($('img').attr('src'), '')
  }
})

test('a corrupt source archive cannot supply a recovered scientific figure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papero-graphic-'))
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'missing-graphics-source.tar.gz'), 'not the pinned source archive')
  const $ = fixture('A8.F13.sf2.g2')
  await assert.rejects(recoverMissingArxivGraphics({ $, arxivId: '2505.16932v5', sourceSha256, directory, fetchImpl: noFetch }), /archive fingerprint mismatch/)
  assert.equal($('img').attr('src'), '')
})
