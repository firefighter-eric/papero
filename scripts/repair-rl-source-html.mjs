import { readFile, writeFile, mkdir, rename, cp } from 'node:fs/promises'
import path from 'node:path'
import { load } from 'cheerio'
import { withExclusivePaperLock } from './catalog-lock.mjs'
import { sha256, sanitizeSvg } from './paper-lib.mjs'
import { updateCatalog } from './import-paper.mjs'

const argv = process.argv.slice(2)
const arg = name => { const i = argv.indexOf(name); if (i < 0 || !argv[i + 1]) throw new Error(`Missing ${name}`); return argv[i + 1] }
const data = arg('--data'), assets = arg('--repair-assets'), recipeFile = arg('--recipe')
const recipeBytes = await readFile(recipeFile), recipe = JSON.parse(recipeBytes)
const receiptBytes = await readFile(path.join(assets, 'render-receipts.json')), receipts = JSON.parse(receiptBytes)
const only = argv.includes('--only') ? arg('--only').split(',') : null
const anchors = ($, node, includeSelf = false) => [...(includeSelf && $(node).attr('id') ? [$(node).attr('id')] : []), ...$(node).find('[id]').map((_, e) => $(e).attr('id')).get()]
const blankAnchors = ids => [...new Set(ids)].map(id => `<span id="${id}"></span>`).join('')
const reports = []
for (const spec of recipe.papers.filter(x => !only || only.includes(x.id))) {
  try {
    await withExclusivePaperLock(data, spec.id, async () => {
      const dir = path.join(data, 'papers', spec.id), file = path.join(dir, 'paper.json')
      const previous = await readFile(file), p = JSON.parse(previous), raw = await readFile(path.join(dir, 'source.html'))
      if (sha256(raw) !== spec.sourceHtmlSha256) throw new Error(`Raw HTML fingerprint mismatch: ${spec.id}`)
      if (p.source.repairs?.some(x => x.method === 'restore-pinned-html-graphics-and-remove-compiler-artifacts' && x.recipeSha256 === sha256(recipeBytes))) { reports.push({ id: p.id, alreadyApplied: true }); return }
      const original = load(raw.toString()), changed = [], newAssets = []
      const blockSpecs = [...spec.blocks, ...(spec.referenceCompilerArtifacts || [])]
      for (const expected of blockSpecs) {
        const b = p.blocks.find(x => x.id === expected.id && x.sourceId === expected.sourceId)
        if (!b || sha256(b.en) !== expected.previousSha256) throw new Error(`Source block fingerprint mismatch: ${spec.id}/${expected.id}`)
        const $ = load(b.en, {}, false), oldIds = $('[id]').map((_, e) => $(e).attr('id')).get()
        for (const crop of spec.crops.filter(c => c.target === b.sourceId)) {
          const node = $(crop.selector).first()
          if (node.length !== 1) throw new Error(`Missing graphics slot: ${crop.selector}`)
          const receipt = receipts.find(r => r.paperId === p.id && r.filename === crop.filename)
          const imageBytes = await readFile(path.join(assets, p.id, crop.filename))
          if (!receipt || sha256(imageBytes) !== receipt.sha256 || receipt.sourcePdfSha256 !== spec.sourcePdfSha256 || JSON.stringify(receipt.bbox) !== JSON.stringify(crop.bbox)) throw new Error('Crop provenance mismatch')
          const preserved = blankAnchors(anchors($, node, !crop.replaceContents))
          const image = `<img src="assets/${crop.filename}" width="${Math.round(crop.bbox[2] - crop.bbox[0])}" height="${Math.round(crop.bbox[3] - crop.bbox[1])}" alt="${crop.alt}">`
          if (crop.replaceContents) node.html(preserved + image)
          else node.replaceWith(preserved + image)
          newAssets.push({ filename: crop.filename, sourceUrl: spec.sourcePdfUrl, sha256: receipt.sha256, sourceSha256: spec.sourcePdfSha256, bytes: imageBytes.length, conversion: { method: 'same-version-pdf-graphic-crop', ...receipt } })
        }
        if (p.id === 'alphazero') {
          const pieces = { '\\symknight': '♘', '\\symbishop': '♗', '\\symqueen': '♕', '\\symrook': '♖' }
          $('.ltx_ERROR').each((_, e) => { const text = $(e).text().trim(); if (!pieces[text]) throw new Error(`Unknown chess macro: ${text}`); $(e).text(pieces[text]).removeClass('ltx_ERROR undefined') })
        }
        if (p.id === 'vdn') for (const svg of spec.inlineSvg) {
          const source = original('[id]').filter((_, el) => original(el).attr('id') === svg.sourceId).first()
          const sourceHtml = original.html(source)
          if (sha256(sourceHtml) !== svg.sourceSha256 || source.find('*').toArray().some(e => !['path', 'g'].includes(e.name.toLowerCase()))) throw new Error(`Unsafe or changed inline SVG: ${svg.sourceId}`)
          const cell = $(`[id="${svg.cellId}"]`)
          if (cell.length !== 1 || cell.find('img').length) throw new Error('Table marker slot mismatch')
          const svgBytes = Buffer.from(sanitizeSvg(sourceHtml))
          await mkdir(path.join(assets, p.id), { recursive: true }); await writeFile(path.join(assets, p.id, svg.filename), svgBytes)
          cell.append(`<img id="${svg.sourceId}" src="assets/${svg.filename}" width="16" height="11" alt="Source architecture marker">`)
          newAssets.push({ filename: svg.filename, sourceUrl: p.source.htmlUrl + '#' + svg.sourceId, sha256: sha256(svgBytes), sourceSha256: svg.sourceSha256, bytes: svgBytes.length, sanitized: true, conversion: { method: 'extract-original-inline-svg', sourceSvgId: svg.sourceId, cellId: svg.cellId } })
        }
        if (p.id === 'option-critic' && b.kind === 'reference') {
          const tags = $('.ltx_tag_bibitem'); if (tags.length !== 1 || !tags.text().includes('\\citeauthoryear')) throw new Error('Reference compiler artifact mismatch')
          tags.html(blankAnchors(anchors($, tags)))
        }
        if (p.id === 'dreamerv3') {
          const root = $.root().children().first(); root.html(blankAnchors(anchors($, root)))
        }
        if (p.id === 'trpo') {
          const listing = $('[id="alg1.3"]'), math = id => $.html($(`[id="${id}"]`)), equation = $.html($('[id="S3.EGx13"]'))
          if (!listing.length || !equation) throw new Error('TRPO algorithm source structure mismatch')
          listing.html(`<div>Initialize ${math('alg1.m1')}.</div><div><strong>for</strong> ${math('alg1.m2')} until convergence:</div><div>Compute all advantage values ${math('alg1.m3')}.</div><div>Solve the constrained optimization problem${equation}</div><div><strong>end for</strong></div>`)
          const failed = $('[id="alg1.4"]'); failed.html(blankAnchors(anchors($, failed)))
        }
        const en = $.html(), newIds = new Set($('[id]').map((_, e) => $(e).attr('id')).get())
        if (oldIds.some(id => !newIds.has(id)) || newIds.size !== $('[id]').length) throw new Error('Repair lost or duplicated an anchor')
        if ($('.ltx_ERROR').length) throw new Error('Unresolved compiler error in repaired block')
        if (en !== b.en) {
          changed.push({ blockId: b.id, sourceId: b.sourceId, previousSha256: sha256(b.en), correctedSha256: sha256(en), previousTranslationArchived: Boolean(b.zh) })
          b.en = en; b.zh = null; delete b.translation
        }
      }
      if (!changed.length) throw new Error('Recipe produced no source corrections')
      const archive = path.join(data, '..', 'archive', `${p.id}-before-html-repair-${Date.now()}`)
      await mkdir(archive, { recursive: true }); await writeFile(path.join(archive, 'paper.json'), previous)
      for (const asset of newAssets) {
        if (p.assets.some(a => a.filename === asset.filename)) throw new Error('Refusing existing asset overwrite')
        await cp(path.join(assets, p.id, asset.filename), path.join(dir, 'assets', asset.filename)); p.assets.push(asset)
      }
      ;(p.source.repairs ??= []).push({ method: 'restore-pinned-html-graphics-and-remove-compiler-artifacts', recipeSha256: sha256(recipeBytes), recipe: path.basename(recipeFile), originalHtmlSha256: spec.sourceHtmlSha256, sourcePdfSha256: spec.sourcePdfSha256, sourcePdfUrl: spec.sourcePdfUrl, renderReceiptsSha256: sha256(receiptBytes), macroReviewSha256: spec.macroReviewSha256, changedBlocks: changed, addedAssets: newAssets.map(a => ({ filename: a.filename, sha256: a.sha256, conversion: a.conversion })), tool: 'repair-rl-source-html.mjs', toolVersion: '1.0.1', toolSha256: sha256(await readFile(new URL(import.meta.url))), reviewedByHuman: false, translationPolicy: 'Changed English blocks reset; actual model responses may only be replayed against matching source fragments. Original blocks and translations archived.' })
      p.translation.status = 'pending'; p.translation.coverage = { complete: p.blocks.filter(b => b.zh).length, total: p.blocks.length }; delete p.translation.completedAt
      await writeFile(file + '.repair-tmp', JSON.stringify(p, null, 2) + '\n'); await rename(file + '.repair-tmp', file); await updateCatalog(data, p)
      reports.push({ id: p.id, changedBlocks: changed.length, addedAssets: newAssets.length })
    })
  } catch (error) { if (!/lock timed out; active owner/.test(error.message)) throw error; reports.push({ id: spec.id, deferred: 'active translation writer' }) }
}
console.log(JSON.stringify(reports))
