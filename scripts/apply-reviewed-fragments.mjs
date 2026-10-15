import { load } from 'cheerio'
import { sha256, translationUnits, assertTranslationFidelity, assertBlockTranslationFidelity, translatedAbstractText } from './paper-lib.mjs'

/** Review producers may group findings by paper/block or list exact units directly. */
export function collectReviewedFragments(report) {
  const selected = new Map()
  function visit(value, paperId, blockId) {
    if (Array.isArray(value)) { for (const item of value) visit(item, paperId, blockId); return }
    if (!value || typeof value !== 'object') return
    paperId = value.paperId || paperId; blockId = value.blockId || blockId
    if (paperId && value.unitId !== undefined && value.sourceTextSha256 && typeof value.suggestedZh === 'string') {
      const id = String(value.unitId), unitId = id.includes(':') ? id : blockId ? `${blockId}:${id}` : null
      if (unitId) selected.set(`${paperId}/${unitId}`, { ...value, paperId, blockId, unitId })
    }
    for (const item of Object.values(value)) if (item && typeof item === 'object') visit(item, paperId, blockId)
  }
  visit(report)
  return [...selected.values()]
}

export function applyReviewedTitle(paper, review, { appliedAt = new Date().toISOString() } = {}) {
  if (review.unitId !== '__title:0' || review.sourceTextSha256 !== sha256(paper.title)
    || !/^[a-f0-9]{64}$/.test(review.reportSha256 || '') || !review.suggestedZh?.trim()) throw Error('Stale title review')
  assertTranslationFidelity(paper.title, review.suggestedZh)
  if (paper.titleZh === review.suggestedZh) return false
  const prior = paper.translation.titleAssistedCorrection
  paper.translation.titleAssistedCorrection = { method: 'codex-subagent-title-correction', model: 'gpt-6-luna', provider: 'Codex subagent',
    parameters: { reasoning_effort: 'low' }, primaryModel: paper.translation.model, sourceTitleSha256: sha256(paper.title),
    previousChineseSha256: prior?.previousChineseSha256 || sha256(paper.titleZh || ''), correctedChineseSha256: sha256(review.suggestedZh),
    draftSha256: sha256(JSON.stringify(review)), reviewSha256: review.reportSha256, appliedAt }
  paper.titleZh = review.suggestedZh
  paper.translation.titleTranslatedSha256 = sha256(paper.titleZh)
  paper.translation.updatedAt = appliedAt
  return true
}

/** Apply observed Luna drafts to source DOM text nodes, retaining the actual primary run. */
export function applyReviewedFragments(paper, reviews, { appliedAt = new Date().toISOString() } = {}) {
  const results = [], failures = []
  for (const block of paper.blocks.filter(block => block.zh)) {
    const patches = reviews.filter(review => review.unitId?.startsWith(`${block.id}:`))
    if (!patches.length) continue
    try {
      const { units } = translationUnits(block.en, block.kind), $ = load(block.zh, {}, false)
      const changed = [], drafts = []
      for (const review of patches) {
        const index = Number(review.unitId.split(':')[1]), unit = units[index]
        if (!unit || sha256(unit.text) !== review.sourceTextSha256 || !/^[a-f0-9]{64}$/.test(review.reportSha256 || '')) throw Error(`Stale source or review fingerprint: ${review.unitId}`)
        if (typeof review.suggestedZh !== 'string' || !review.suggestedZh.trim()) throw Error(`Empty draft: ${review.unitId}`)
        try { assertTranslationFidelity(unit.text, review.suggestedZh) }
        catch (error) { throw Error(`${review.unitId}: ${error.message}`, { cause: error }) }
        const indices = []; let node = unit.node
        while (node.parent) { indices.unshift(node.parent.children.indexOf(node)); node = node.parent }
        let target = $.root()[0]
        for (const index of indices) target = target?.children?.[index]
        if (target?.type !== 'text') throw Error(`DOM text path changed: ${review.unitId}`)
        if (target.data !== review.suggestedZh) { target.data = review.suggestedZh; changed.push(index) }
        drafts.push({ unitId: review.unitId, sourceTextSha256: review.sourceTextSha256, suggestedZh: review.suggestedZh, reportSha256: review.reportSha256 })
      }
      if (!changed.length) continue
      const corrected = $.root().html()
      assertBlockTranslationFidelity(block.en, corrected)
      const prior = block.translation.assistedCorrection?.method === 'codex-subagent-fragment-correction'
        ? block.translation.originalTranslationMetadata : structuredClone(block.translation)
      if (!prior || prior.status !== 'machine') throw Error('Missing original machine translation metadata')
      const previousChineseSha256 = block.translation.assistedCorrection?.method === 'codex-subagent-fragment-correction'
        ? block.translation.assistedCorrection.previousChineseSha256 : sha256(block.zh)
      const unitIds = [...new Set([...(block.translation.assistedCorrection?.method === 'codex-subagent-fragment-correction' ? block.translation.assistedCorrection.unitIds : []), ...changed])].sort((a, b) => a - b)
      const receipt = { id: `luna-fragments-${block.id}-${sha256(JSON.stringify(drafts)).slice(0, 16)}`, blockId: block.id, sourceId: block.sourceId,
        method: 'codex-subagent-fragment-correction', assistingModel: 'gpt-6-luna', assistingProvider: 'Codex subagent', primaryModel: prior.model,
        sourceSha256: paper.source.sha256, sourceBlockSha256: sha256(block.en), draftSha256: sha256(JSON.stringify(drafts)), previousChineseSha256,
        correctedChineseSha256: sha256(corrected), unitIds, appliedAt }
      block.zh = corrected
      block.translation = { ...prior, originalTranslationMetadata: prior, translatedSha256: sha256(corrected), assistedCorrection: receipt }
      paper.translation.assistedCorrections = [...(paper.translation.assistedCorrections || []).filter(item => item.blockId !== block.id), receipt]
      results.push({ blockId: block.id, unitIds: changed, draftSha256: receipt.draftSha256 })
    } catch (error) { failures.push({ blockId: block.id, error: error.message }) }
  }
  if (results.length) {
    paper.translation.updatedAt = appliedAt
    paper.translation.humanReviewed = false
    paper.abstractZh = translatedAbstractText(paper.blocks)
    for (const section of paper.sections || []) {
      const heading = paper.blocks.find(block => block.kind === 'heading' && block.sectionId === section.id && block.zh)
      if (heading) { const $ = load(heading.zh, {}, false); $('annotation,annotation-xml').remove(); section.titleZh = $.root().text().replace(/\s+/g, ' ').trim() }
    }
  }
  return { results, failures }
}
