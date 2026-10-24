import { sha256 } from './paper-lib.mjs'

export const sourceBlockSnapshot = blocks => blocks.map(block => ({ id: block.id, sourceId: block.sourceId, enSha256: sha256(block.en) }))

/** A semantic repair can regroup original cells/notes without losing prior run coverage. */
export function sourceStructureHistoryCounts(paper) {
  const revisions = paper.source.structureRevisions
  if (revisions === undefined) return []
  const fail = () => { throw new Error(`Invalid source structure revision: ${paper.id}.`) }
  if (!Array.isArray(revisions) || !revisions.length) fail()
  const counts = new Set()
  let previousResult
  const snapshot = value => Array.isArray(value) && value.length > 0 && new Set(value.map(b => b?.id)).size === value.length
    && value.every(b => b && typeof b.id === 'string' && b.id.length > 0 && typeof b.sourceId === 'string' && b.sourceId.length > 0
      && /^[a-f0-9]{64}$/.test(b.enSha256 || '') && Object.keys(b).length === 3)
  for (const revision of revisions) {
    if (revision?.method !== 'fixed-source-semantic-recovery' || revision.sourceSha256 !== paper.source.sha256
      || !Number.isFinite(Date.parse(revision.recoveredAt)) || !/^[a-f0-9]{64}$/.test(revision.toolSha256 || '')
      || !snapshot(revision.previousBlocks) || !snapshot(revision.resultingBlocks)
      || revision.previousBlockCount !== revision.previousBlocks.length || revision.resultingBlockCount !== revision.resultingBlocks.length
      || revision.previousBlocksSha256 !== sha256(JSON.stringify(revision.previousBlocks))
      || revision.resultingBlocksSha256 !== sha256(JSON.stringify(revision.resultingBlocks))
      || previousResult !== undefined && revision.previousBlocksSha256 !== previousResult) fail()
    counts.add(revision.previousBlockCount)
    counts.add(revision.resultingBlockCount)
    previousResult = revision.resultingBlocksSha256
  }
  if (previousResult !== sha256(JSON.stringify(sourceBlockSnapshot(paper.blocks)))) fail()
  return [...counts]
}
