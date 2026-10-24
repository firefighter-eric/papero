import test from 'node:test'
import assert from 'node:assert/strict'
import { assertChineseHeadingCompleteness } from './heading-provenance.mjs'
import { sha256 } from './paper-lib.mjs'

const fixture = (en = 'Objectives', zh = en) => ({ id: 'heading', translation: {},
  blocks: [{ id: 'title', kind: 'heading', en: `<h3>${en}</h3>`, zh: `<h3>${zh}</h3>` }] })

test('a single untranslated heading word fails while Chinese headings and exact model labels pass', () => {
  assert.throws(() => assertChineseHeadingCompleteness(fixture()), /Untranslated heading/)
  assert.doesNotThrow(() => assertChineseHeadingCompleteness(fixture('Objectives', '目标')))
  assert.doesNotThrow(() => assertChineseHeadingCompleteness(fixture('Qwen2-72B')))
})

test('an intentionally preserved benchmark needs a current source-and-target-bound real review', () => {
  const paper = fixture('NeedleBench'), block = paper.blocks[0]
  assert.throws(() => assertChineseHeadingCompleteness(paper), /verified label review/)
  const review = { blockId: block.id, decision: 'preserve-label', model: 'gpt-6-luna', provider: 'Codex subagent', reasoningEffort: 'low',
    humanReviewed: false, reason: 'Synthetic fixture: benchmark name.', reviewSha256: 'a'.repeat(64), reviewedAt: '2026-10-15T00:00:00Z',
    sourceBlockSha256: sha256(block.en), chineseBlockSha256: sha256(block.zh) }
  paper.translation.headingReviews = [review]
  assert.doesNotThrow(() => assertChineseHeadingCompleteness(paper))
  review.chineseBlockSha256 = sha256('stale translation')
  assert.throws(() => assertChineseHeadingCompleteness(paper), /verified label review/)
})

test('appendix numbering is separate from exact RL algorithm and benchmark labels', () => {
  const paper = fixture('<span class="ltx_tag">A.2.1 </span>Decision Transformer')
  assert.doesNotThrow(() => assertChineseHeadingCompleteness(paper))
  paper.blocks[0].zh = '<h3><span class="ltx_tag">A.2.1 </span>Rainbow</h3>'
  assert.throws(() => assertChineseHeadingCompleteness(paper), /changes an RL label/)
  assert.throws(() => assertChineseHeadingCompleteness(fixture('<span class="ltx_tag">A.2 </span>Learning from data')), /Untranslated heading/)
})


test('numbered headings recognize exact technical labels without exempting descriptive headings', () => {
  assert.doesNotThrow(() => assertChineseHeadingCompleteness(fixture('<span class="ltx_tag">A.3 </span>FinOps')))
  assert.throws(() => assertChineseHeadingCompleteness(fixture('<span class="ltx_tag">A.3 </span>FinOps analysis')), /Untranslated heading/)
})
