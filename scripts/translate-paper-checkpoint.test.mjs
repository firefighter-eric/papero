import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { translatePaper } from './translate-paper.mjs'
import { sha256 } from './paper-lib.mjs'

test('failed resume stamps the saved checkpoint after its request history and retains accepted text', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'papero-failed-resume-'))
  const originalFetch = globalThis.fetch, model = 'qwen3.6-35b-a3b'
  const directory = path.join(dataDir, 'papers', 'synthetic-failure')
  await mkdir(directory, { recursive: true })
  const accepted = { id: 'block-001', kind: 'paragraph', en: '<p>Accepted text.</p>', zh: '<p>已接受的文本。</p>', translation: { status: 'machine', model, translatedAt: '2026-01-01T00:00:00.000Z' } }
  const paper = { schemaVersion: 1, id: 'synthetic-failure', title: 'Failure fixture', titleZh: '失败测试', authors: ['Test'], year: 2026, tags: [], abstract: '', source: { kind: 'arxiv', sha256: sha256('synthetic') },
    sections: [], assets: [], statistics: { blockCount: 2, sectionCount: 0 }, blocks: [accepted, { id: 'block-002', kind: 'paragraph', en: '<p>We use 2 layers.</p>', zh: null }],
    translation: { status: 'pending', model, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', humanReviewed: false, coverage: { complete: 1, total: 2 } } }
  const filename = path.join(directory, 'paper.json')
  await writeFile(filename, JSON.stringify(paper))
  globalThis.fetch = async url => {
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ models: [] }))
    if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: model }] }))
    assert.ok(url.endsWith('/chat/completions'))
    return new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: { 'block-002:0': '我们使用3层。' } }) } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }))
  }
  try {
    await assert.rejects(translatePaper({ id: paper.id, dataDir, model }), /Numeric value/)
    const saved = JSON.parse(await readFile(filename, 'utf8'))
    assert.deepEqual(saved.blocks[0], { ...accepted, translation: { ...accepted.translation, parameters: saved.translation.modelHistory[0].parameters, modelIdentity: saved.translation.modelHistory[0].modelIdentity, provider: saved.translation.modelHistory[0].provider } })
    assert.equal(saved.blocks[1].zh, null)
    assert.equal(saved.translation.status, 'pending')
    assert.deepEqual(saved.translation.coverage, { complete: 1, total: 2 })
    assert.ok(Date.parse(saved.translation.updatedAt) >= Date.parse(saved.translation.modelHistory.at(-1).startedAt))
    assert.ok(saved.translation.usage.completionTokens > 0)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('joined-block rejection never saves a formula-adjacent extra percentage as accepted text', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'papero-joined-rejection-'))
  const originalFetch = globalThis.fetch, model = 'qwen3.6-35b-a3b'
  const directory = path.join(dataDir, 'papers', 'joined-rejection')
  await mkdir(directory, { recursive: true })
  const paper = { schemaVersion: 1, id: 'joined-rejection', title: 'Joined fixture', titleZh: '拼接测试', authors: ['Test'], year: 2026, tags: [], abstract: '',
    source: { kind: 'arxiv', sha256: sha256('synthetic') }, sections: [], assets: [], statistics: { blockCount: 1, sectionCount: 0 },
    blocks: [{ id: 'block-001', kind: 'paragraph', en: '<p>The model is 10<math><mo>×</mo></math> smaller.</p>', zh: null }],
    translation: { status: 'pending', model, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', humanReviewed: false, coverage: { complete: 0, total: 1 } } }
  const filename = path.join(directory, 'paper.json')
  await writeFile(filename, JSON.stringify(paper))
  globalThis.fetch = async url => {
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ models: [] }))
    if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: model }] }))
    return new Response(JSON.stringify({ model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: { 'block-001:0': '模型规模缩小 10', 'block-001:1': '%。' } }) } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }))
  }
  try {
    await assert.rejects(translatePaper({ id: paper.id, dataDir, model }), /Numeric value/)
    const saved = JSON.parse(await readFile(filename, 'utf8'))
    assert.equal(saved.blocks[0].zh, null)
    assert.equal(saved.blocks[0].translation, undefined)
    assert.equal(saved.translation.status, 'pending')
    assert.deepEqual(saved.translation.coverage, { complete: 0, total: 1 })
    assert.ok(saved.translation.usage.completionTokens > 0)
  } finally {
    globalThis.fetch = originalFetch
    await rm(dataDir, { recursive: true, force: true })
  }
})
