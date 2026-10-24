import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256 } from './paper-lib.mjs'
import { sourceBlockSnapshot, sourceStructureHistoryCounts } from './source-structure-provenance.mjs'

test('source structure recovery retains auditable prior coverage across regrouped tables and notes', () => {
  const old = [{ id: 'cell-1', sourceId: 't.c1', en: '<p>First cell</p>' }, { id: 'cell-2', sourceId: 't.c2', en: '<p>Second cell</p>' }]
  const blocks = [{ id: 'table', sourceId: 't', en: '<table><tr><td>First cell</td><td>Second cell</td></tr></table>' }]
  const previousBlocks = sourceBlockSnapshot(old), resultingBlocks = sourceBlockSnapshot(blocks)
  const paper = { id: 'fixture', blocks, source: { sha256: sha256('fixed original source'), structureRevisions: [{
    method: 'fixed-source-semantic-recovery', sourceSha256: sha256('fixed original source'), recoveredAt: '2026-10-24T00:00:00.000Z',
    toolSha256: sha256('conversion script'), previousBlocks, resultingBlocks, previousBlockCount: 2, resultingBlockCount: 1,
    previousBlocksSha256: sha256(JSON.stringify(previousBlocks)), resultingBlocksSha256: sha256(JSON.stringify(resultingBlocks)),
  }] } }
  assert.deepEqual(sourceStructureHistoryCounts(paper), [2, 1])
  for (const mutate of [
    p => { p.source.structureRevisions[0].sourceSha256 = sha256('other version') },
    p => { p.source.structureRevisions[0].previousBlockCount = 3 },
    p => { p.source.structureRevisions[0].previousBlocks[0].enSha256 = sha256('changed') },
    p => { p.blocks[0].en = '<table><tr><td>Missing second cell</td></tr></table>' },
    p => { p.source.structureRevisions.push(structuredClone(p.source.structureRevisions[0])) },
  ]) {
    const bad = structuredClone(paper); mutate(bad)
    assert.throws(() => sourceStructureHistoryCounts(bad), /Invalid source structure revision/)
  }
})
