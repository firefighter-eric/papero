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
