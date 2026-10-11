import assert from 'node:assert/strict'
import test from 'node:test'
import registry from '../paper-metadata/bibliography.json' with { type: 'json' }
import { attachPublicationBibliography, publicationAuthors } from './publication-bibliography.mjs'
import { createPublication, parseReadingHtml } from './publication-html.mjs'
import { createCodexTranslationManifest } from './apply-codex-translations.mjs'
import { sha256 } from './paper-lib.mjs'

function fixture(id) {
  const official = registry.papers[id]
  return { schemaVersion: 1, id, arxivId: official.arxivId, title: 'Synthetic bibliography fixture', titleZh: '合成署名测试',
    authors: [], year: 2024, tags: ['Testing'], abstract: '', statistics: {}, assets: [],
    source: { kind: 'arxiv', url: official.sourceUrl, htmlUrl: official.sourceUrl.replace('/abs/', '/html/'), sha256: sha256('synthetic source') },
    sections: [{ id: 'intro', title: 'Introduction', level: 2 }],
    blocks: [{ id: 'block-001', sourceId: 'intro', sectionId: 'intro', kind: 'paragraph', en: '<p id="intro">Synthetic fixture text.</p>', zh: '<p id="intro">合成测试文本。</p>' }] }
}

test('official author fallback preserves frozen source identity and standalone HTML reconstruction', () => {
  for (const id of ['olmo-2-technical-report', 'olmo-3-technical-report']) {
    const paper = fixture(id), before = structuredClone(paper)
    const options = { prompt: 'Synthetic test prompt', createdAt: '2026-01-01T00:00:00Z' }
    const frozen = createCodexTranslationManifest(paper, options)
    const augmented = attachPublicationBibliography(paper)
    assert.deepEqual(paper, before)
    assert.deepEqual(augmented.authors, [])
    assert.deepEqual(augmented.publicationBibliography, registry.papers[id])
    assert.deepEqual(createCodexTranslationManifest(augmented, options), frozen)
    const { metadata, html } = createPublication(paper)
    assert.deepEqual(metadata.authors, [])
    assert.deepEqual(publicationAuthors(metadata), registry.papers[id].authors)
    for (const language of ['en', 'zh']) {
      assert.ok(html[language].includes(registry.papers[id].authors[0]))
      assert.equal(parseReadingHtml(html[language], metadata, language)[0][language], paper.blocks[0][language])
    }
  }
})

test('unknown sources receive no author exception and original nonempty credits stay unchanged', () => {
  const paper = fixture('olmo-2-technical-report')
  for (const mutate of [p => { p.id = 'unknown-report' }, p => { p.arxivId = '2501.00656v2' }, p => { p.source.url += '?other=1' }]) {
    const changed = structuredClone(paper); mutate(changed)
    assert.equal(attachPublicationBibliography(changed).publicationBibliography, undefined)
    assert.deepEqual(publicationAuthors(changed), [])
  }
  paper.authors = ['Original author']
  assert.deepEqual(publicationAuthors(attachPublicationBibliography(paper)), paper.authors)
  assert.equal(attachPublicationBibliography(paper).publicationBibliography, undefined)
})

test('forged, drifted and extra author records reject in validation and HTML rendering', () => {
  const original = attachPublicationBibliography(fixture('olmo-2-technical-report'))
  for (const mutate of [
    p => { p.id = 'unknown-report' }, p => { p.arxivId = '2501.00656v2' }, p => { p.source.url += '?changed=1' },
    p => { p.source.kind = 'official-paper' }, p => { p.authors = ['Original author'] },
    p => { p.publicationBibliography.authors.reverse() }, p => { p.publicationBibliography.authors[0] = 'Invented author' },
    p => { p.publicationBibliography.authors = [] }, p => { p.publicationBibliography.verifiedAt = '2026-01-01T00:00:00Z' },
    p => { p.publicationBibliography.extra = true }, p => { delete p.publicationBibliography.sourceUrl },
  ]) {
    const changed = structuredClone(original); mutate(changed)
    assert.throws(() => publicationAuthors(changed), /publication bibliography/)
    assert.throws(() => createPublication(changed), /publication bibliography/)
  }
  const { metadata, html } = createPublication(original)
  delete metadata.publicationBibliography
  assert.throws(() => parseReadingHtml(html.en, metadata, 'en'), /document structure/)
})
