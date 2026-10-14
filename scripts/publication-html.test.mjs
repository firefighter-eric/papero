import test from 'node:test'
import assert from 'node:assert/strict'
import { renderReadingDocument } from './publication-html.mjs'
import { load } from 'cheerio'

test('standalone section references resolve once while block byte ranges retain exact source bodies', () => {
  const paper = { id: 'section-links', title: 'Sections', titleZh: '章节', authors: ['Author'],
    source: { url: 'https://arxiv.org/abs/1706.03762v7' }, sections: [{ id: 'intro' }, { id: 'results' }],
    blocks: [
      { id: 'one', sourceId: 'heading', sectionId: 'intro', kind: 'heading', en: '<h2>Introduction</h2>', zh: '<h2>引言</h2>' },
      { id: 'two', sourceId: 'body', sectionId: 'intro', kind: 'paragraph', en: '<p><a href="#intro">Intro</a><a href="#results">Results</a></p>', zh: '<p><a href="#intro">引言</a><a href="#results">结果</a></p>' },
      { id: 'three', sourceId: 'results', sectionId: 'results', kind: 'heading', en: '<h2 id="results">Results</h2>', zh: '<h2 id="results">结果</h2>' },
    ] }
  for (const language of ['en', 'zh']) {
    const document = renderReadingDocument(paper, language), $ = load(document.html)
    assert.equal($('#intro').length, 1)
    assert.equal($('#results').length, 1)
    for (const link of $('a[href^="#"]').toArray()) assert.equal($(`[id="${$(link).attr('href').slice(1)}"]`).length, 1)
    document.offsets.forEach((range, index) => assert.equal(Buffer.from(document.html).subarray(range.start, range.end).toString(), paper.blocks[index][language]))
  }
})

test('PDF mathematical vectors retain scalable tall expressions and dark-mode contrast in standalone HTML', () => {
  const paper = { id: 'pdf-vectors', title: 'Source report', authors: ['Author'], source: { kind: 'arxiv', url: 'https://arxiv.org/abs/1412.6980v9', conversion: { parameters: { mathMode: 'original-pdf-vectors' } } },
    blocks: [{ id: 'block-001', kind: 'equation', sourceId: 'eq', sectionId: 'intro', en: '<p><img class="pdf-math pdf-math-h151" src="assets/math.svg" alt="Source formula"></p>' }] }
  const document = renderReadingDocument(paper, 'en')
  assert.match(document.html, /\.pdf-math\.pdf-math-h151\{height:15\.1em\}/)
  assert.match(document.html, /@media\(prefers-color-scheme:dark\)\{\.pdf-math\{filter:invert\(1\)\}\}/)
  const offset = document.offsets[0]
  assert.equal(Buffer.from(document.html).subarray(offset.start, offset.end).toString(), paper.blocks[0].en)
  const ordinary = renderReadingDocument({ ...paper, source: { ...paper.source, conversion: undefined } }, 'en')
  assert.doesNotMatch(ordinary.html, /filter:invert|height:15\.1em/)
})
