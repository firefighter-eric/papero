import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceAssetMetadata } from './publication-assets.mjs'
import { sha256 } from './paper-lib.mjs'
import { createCodexTranslationManifest } from './apply-codex-translations.mjs'

const used = { filename: 'used.png', sha256: sha256('used'), bytes: 4, sourceUrl: 'https://example.com/used.png' }
const unused = { filename: 'unused.png', sha256: sha256('unused'), bytes: 6, sourceUrl: 'https://example.com/unused.png' }

test('published asset closure preserves the exact frozen translation source manifest', () => {
  const paper = { schemaVersion: 1, id: 'synthetic-assets', arxivId: '2401.00001v1', title: 'Synthetic test', authors: ['Test Author'], year: 2024,
    tags: [], abstract: '', source: { sha256: sha256('source') }, sections: [{ id: 'intro', title: 'Intro', level: 2 }], statistics: {},
    blocks: [{ id: 'block-001', sourceId: 'intro', sectionId: 'intro', kind: 'paragraph', en: '<p id="intro">Synthetic source.</p>' }], assets: [used, unused] }
  const options = { prompt: 'Synthetic test prompt', createdAt: '2026-01-01T00:00:00Z' }
  const frozen = createCodexTranslationManifest(paper, options)
  const published = { ...paper, assets: [used], publicationSourceAssets: structuredClone(paper.assets) }
  assert.deepEqual(sourceAssetMetadata(published), paper.assets)
  assert.deepEqual(createCodexTranslationManifest(published, options), frozen)
  published.publicationSourceAssets[1].sha256 = sha256('changed unused source')
  assert.notEqual(createCodexTranslationManifest(published, options).sourceDocumentSha256, frozen.sourceDocumentSha256)
})

test('invalid or inconsistent frozen asset metadata cannot excuse a changed published file', () => {
  const paper = { id: 'synthetic-assets', assets: [used], publicationSourceAssets: structuredClone([used, unused]) }
  for (const mutate of [
    p => { p.publicationSourceAssets = [] }, p => { p.publicationSourceAssets = [used] },
    p => { p.publicationSourceAssets.push(used) }, p => { p.publicationSourceAssets[1].filename = '../unused.png' },
    p => { p.publicationSourceAssets[1].sha256 = 'invalid' }, p => { p.publicationSourceAssets[1].bytes = -1 },
    p => { p.assets[0].sha256 = sha256('changed published file') }, p => { p.assets[0].filename = 'invented.png' },
  ]) {
    const changed = structuredClone(paper); mutate(changed)
    assert.throws(() => sourceAssetMetadata(changed), /frozen source asset metadata/)
  }
})
