import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertModelContinuation, beginModelRun, recordModelUsage } from './translation-provenance.mjs'
import { parseTranslationArgs } from './translate-paper.mjs'

const identity = model => ({ apiModelId: model, format: model === 'old' ? 'splash' : 'mlx', quantization: '4bit' })
const parameters = { temperature: 0.1, seed: 42 }
const fixture = () => ({ titleZh: '论文', blocks: [{ id: 'accepted', zh: '旧译文', translation: { status: 'machine', model: 'old', translatedAt: '2026-01-02T00:00:00.000Z' } }, { id: 'pending', zh: null }], translation: { model: 'old', modelIdentity: identity('old'), provider: 'LM Studio local API', parameters, promptSha256: 'a'.repeat(64), createdAt: '2026-01-01T00:00:00.000Z', usage: { promptTokens: 100, completionTokens: 50 } } })

test('model continuation refuses implicit substitution without mutating historical provenance', () => {
  const paper = fixture(), before = structuredClone(paper)
  assert.throws(() => assertModelContinuation(paper, 'new'), /allow-model-change/)
  assert.throws(() => assertModelContinuation(paper, 'new', 'true'), /explicit boolean/)
  assert.deepEqual(paper, before)
  assert.doesNotThrow(() => assertModelContinuation(paper, 'old'))
  assert.doesNotThrow(() => assertModelContinuation(paper, 'new', true))
})

test('explicit model runs retain legacy blocks, identity, settings and attributable usage', () => {
  const paper = fixture()
  beginModelRun(paper, { model: 'new', modelIdentity: identity('new'), provider: 'LM Studio local API', parameters: { ...parameters, temperature: 0.2 }, promptSha256: 'b'.repeat(64), startedAt: '2026-01-03T00:00:00.000Z' })
  assert.equal(paper.blocks[0].translation.model, 'old')
  assert.deepEqual(paper.blocks[0].translation.modelIdentity, identity('old'))
  assert.deepEqual(paper.blocks[0].translation.parameters, parameters)
  assert.deepEqual(paper.translation.modelsUsed, ['old', 'new'])
  assert.equal(paper.translation.modelHistory[0].startedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(paper.translation.modelHistory.at(-1).reason, 'explicit-model-change')
  assert.equal(paper.translation.modelHistory.at(-1).previousModel, 'old')
  recordModelUsage(paper.translation, 'new', { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 0 } })
  assert.deepEqual(paper.translation.usageByModel.old, { promptTokens: 100, completionTokens: 50 })
  assert.deepEqual(paper.translation.usageByModel.new, { promptTokens: 10, completionTokens: 5, observedReasoningTokens: 0, reasoningUsageResponses: 1 })
  assert.deepEqual(paper.translation.usage, { promptTokens: 110, completionTokens: 55, observedReasoningTokens: 0, reasoningUsageResponses: 1 })
  const usageBefore = structuredClone(paper.translation.usageByModel)
  assert.throws(() => recordModelUsage(paper.translation, 'new', { prompt_tokens: 10, completion_tokens: -1 }), /nonnegative/)
  assert.deepEqual(paper.translation.usageByModel, usageBefore)
})

test('CLI model authorization and option values never become positional paper ids', () => {
  const args = parseTranslationArgs(['--model', 'qwen3.6-35b-a3b', '--concurrency=2', '--allow-model-change', 'example'])
  assert.equal(args.id, 'example'); assert.equal(args.model, 'qwen3.6-35b-a3b'); assert.equal(args.concurrency, 2); assert.equal(args.allowModelChange, true)
  assert.equal(parseTranslationArgs(['example', '--model=exact-id']).allowModelChange, false)
  assert.throws(() => parseTranslationArgs(['--model', '--allow-model-change']), /Missing value/)
  assert.throws(() => parseTranslationArgs(['--allow-model-change=false']), /does not accept/)
})
