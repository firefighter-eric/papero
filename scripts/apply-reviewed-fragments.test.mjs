import test from 'node:test'
import assert from 'node:assert/strict'
import { applyReviewedFragments, collectReviewedFragments, applyReviewedTitle } from './apply-reviewed-fragments.mjs'
import { assertLocalResponseReplay } from './verify-release-data.mjs'
import { sha256, translationUnits } from './paper-lib.mjs'

function fixture() {
  const en = '<p>The model uses <math><mn>4</mn></math> layers. <strong>Training uses 8 batches.</strong></p>'
  const zh = '<p>模型不使用 <math><mn>4</mn></math> 层。 <strong>训练使用 8 个批次。</strong></p>'
  const parameters = { temperature: 0.1, top_p: 0.9, max_tokens: 4096, seed: 42, reasoning_effort: 'none', stream: false }
  const model = 'qwen3.6-35b-a3b', provider = 'LM Studio local API', modelIdentity = { apiModelId: model }
  const startedAt = '2026-10-15T00:00:00.000Z', translatedAt = '2026-10-15T00:01:00.000Z'
  const block = { id: 'block-001', sourceId: 'p1', kind: 'paragraph', en, zh, translation: { status: 'machine', model, provider, parameters, modelIdentity, translatedAt, translatedSha256: sha256(zh), responseReplay: {
    method: 'validated-local-response-replay', sourcePaperSha256: 'a'.repeat(64), sourceBlockSha256: sha256(en), translatedBlockSha256: sha256(zh), assembledAt: translatedAt,
    units: translationUnits(en).units.map((unit, unitId) => ({ unitId, sourceTextSha256: sha256(unit.text), responseFile: 'translation-response-1.json', responseSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), model, provider, modelIdentity, parameters, requestRunStartedAt: startedAt })) } } }
  const paper = { id: 'test', source: { sha256: 'a'.repeat(64) }, blocks: [block], sections: [], translation: { updatedAt: translatedAt, modelHistory: [{ model, provider, modelIdentity, parameters, startedAt }] } }
  const review = { unitId: 'block-001:0', sourceTextSha256: sha256('The model uses '), suggestedZh: '模型使用 ', reportSha256: 'd'.repeat(64) }
  return { paper, block, review }
}

test('nested review schemas retain exact paper and block identities and numeric unit indices', () => {
  const fragment = { unitId: '0', sourceTextSha256: 'a'.repeat(64), suggestedZh: '忠实的修订' }
  const actual = collectReviewedFragments({ failedBlocks: [{ paperId: 'example', blockId: 'block-001', units: [fragment] }] })
  assert.equal(actual.length, 1)
  assert.equal(actual[0].paperId, 'example')
  assert.equal(actual[0].unitId, 'block-001:0')
  assert.equal(collectReviewedFragments({ reviews: [{ blockId: 'block-001', status: 'reviewed' }] }).length, 0)
})

test('a reviewed title correction binds the exact source and keeps the primary model identity', () => {
  const { paper } = fixture()
  paper.title = 'Off-Policy Reinforcement Learning'; paper.titleZh = '离线强化学习'
  paper.translation.model = 'qwen3.6-35b-a3b'
  const review = { unitId: '__title:0', sourceTextSha256: sha256(paper.title), suggestedZh: '离策略强化学习', reportSha256: 'd'.repeat(64) }
  assert.equal(applyReviewedTitle(paper, review), true)
  assert.equal(paper.translation.titleAssistedCorrection.primaryModel, 'qwen3.6-35b-a3b')
  assert.equal(paper.translation.titleAssistedCorrection.correctedChineseSha256, sha256(paper.titleZh))
  assert.throws(() => applyReviewedTitle(paper, { ...review, sourceTextSha256: 'e'.repeat(64) }), /Stale title/)
})

test('observed corrections preserve math, surrounding nodes and the original response replay chain', () => {
  const { paper, block, review } = fixture()
  assertLocalResponseReplay(paper, block)
  const original = structuredClone(block.translation)
  const result = applyReviewedFragments(paper, [review])
  assert.deepEqual(result.failures, [])
  assert.equal(block.zh, '<p>模型使用 <math><mn>4</mn></math> 层。 <strong>训练使用 8 个批次。</strong></p>')
  assert.deepEqual(block.translation.originalTranslationMetadata, original)
  assertLocalResponseReplay(paper, block)
  block.translation.originalTranslationMetadata.translatedSha256 = 'e'.repeat(64)
  assert.throws(() => assertLocalResponseReplay(paper, block), /corrected local response replay chain/)
})

test('stale reviewed sources and changed numeric literals cannot replace an accepted block', () => {
  for (const change of [review => { review.sourceTextSha256 = 'e'.repeat(64) }, review => { review.unitId = 'block-001:2'; review.sourceTextSha256 = sha256('Training uses 8 batches.'); review.suggestedZh = '训练使用 9 个批次。' }]) {
    const { paper, block, review } = fixture(), before = JSON.stringify(paper)
    change(review)
    assert.equal(applyReviewedFragments(paper, [review]).failures.length, 1)
    assert.equal(JSON.stringify(paper), before)
    assert.ok(block.zh.includes('8'))
  }
})
