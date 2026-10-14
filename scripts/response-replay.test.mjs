import test from 'node:test'
import assert from 'node:assert/strict'
import { assertLocalResponseReplay } from './verify-release-data.mjs'
import { sha256, translationUnits } from './paper-lib.mjs'

function fixture() {
  const model = 'qwen3.6-35b-a3b', provider = 'LM Studio local API'
  const parameters = { temperature: 0.1, top_p: 0.9, max_tokens: 4096, seed: 42, reasoning_effort: 'none', stream: false }
  const history = [8192, 16384].map((contextLength, i) => ({ model, provider, modelIdentity: { apiModelId: model, contextLength },
    parameters: { ...parameters, max_tokens: i ? 7000 : 4096 }, startedAt: `2026-10-14T1${i}:00:00Z` }))
  const block = { id: 'block-001', kind: 'paragraph', en: '<p>First sentence <em>second part.</em></p>', zh: '<p>第一句<em>第二部分。</em></p>' }
  const assembledAt = '2026-10-14T12:00:00Z'
  const paper = { id: 'fixture', source: { sha256: sha256('source') }, translation: { updatedAt: assembledAt, modelHistory: history } }
  block.translation = { model, provider, translatedAt: assembledAt, responseReplay: { method: 'validated-local-response-replay', sourcePaperSha256: paper.source.sha256,
    sourceBlockSha256: sha256(block.en), translatedBlockSha256: sha256(block.zh), assembledAt,
    units: translationUnits(block.en).units.map((u, i) => ({ unitId: i, sourceTextSha256: sha256(u.text), responseFile: `translation-response-1791972000000-100-${i}.json`,
      responseSha256: sha256(`response ${i}`), promptSha256: sha256('prompt'), model, provider, modelIdentity: { ...history[i].modelIdentity },
      parameters: { ...history[i].parameters, seed: 42 + i }, requestRunStartedAt: history[i].startedAt })) } }
  return { paper, block }
}

test('response replay binds mixed contexts and retry seeds to the actual declared runs', () => {
  const { paper, block } = fixture()
  assertLocalResponseReplay(paper, block)
})

test('response replay rejects stale text, missing units, unknown contexts, seeds and source changes', () => {
  for (const change of [
    b => { b.translation.responseReplay.units.pop() },
    b => { b.translation.responseReplay.units[0].sourceTextSha256 = sha256('other source') },
    b => { b.translation.responseReplay.units[0].modelIdentity.contextLength = 4096 },
    b => { b.translation.responseReplay.units[0].parameters.seed = 45 },
    b => { b.translation.responseReplay.units[0].parameters.max_tokens = 7000 },
    b => { b.translation.responseReplay.units[0].requestRunStartedAt = '2026-10-14T09:00:00Z' },
    b => { b.translation.responseReplay.units[0].responseFile = '../response.json' },
    b => { b.zh = '<p>Changed body.</p>' },
  ]) {
    const { paper, block } = structuredClone(fixture())
    change(block)
    assert.throws(() => assertLocalResponseReplay(paper, block), /replay provenance/)
  }
})

test('recovered title notes keep historical block totals without changing past coverage', async () => {
  const { historicalBlockCounts } = await import('./verify-release-data.mjs')
  const added = { id: 'title-notes', kind: 'paragraph', sectionId: 'frontmatter', en: '<p>Original note.</p>' }
  const repair = { method: 'separate-title-publication-notes-into-frontmatter', addedBlockId: added.id, previousBlockCount: 1, title: 'Original title', notesSha256: sha256(added.en) }
  const paper = { id: 'fixture', title: repair.title, source: { repairs: [repair] }, blocks: [added, { id: 'body' }] }
  assert.deepEqual([...historicalBlockCounts(paper)], [2, 1])
  repair.notesSha256 = sha256('unrelated note')
  assert.throws(() => historicalBlockCounts(paper), /title-note block revision/)
})
