import test from 'node:test'
import assert from 'node:assert/strict'
import { renderReadingDocument } from './publication-html.mjs'

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
