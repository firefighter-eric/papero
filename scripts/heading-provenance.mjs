import { load } from 'cheerio'
import { isTechnicalLabelOnly, sha256, visibleProseText } from './paper-lib.mjs'

/** Short headings need the same completeness gate as longer narrative text. */
export function assertChineseHeadingCompleteness(paper) {
  const reviews = new Map((paper.translation.headingReviews || []).map(review => [review.blockId, review]))
  for (const block of paper.blocks) {
    if (block.kind !== 'heading' || !block.zh) continue
    const source = visibleProseText(load(block.en, {}, false))
    const target = visibleProseText(load(block.zh, {}, false))
    if (!/[A-Za-z]{2}/.test(source) || /[\u3400-\u9fff]/.test(target) || isTechnicalLabelOnly(source)) continue
    const review = reviews.get(block.id)
    if (review?.decision !== 'preserve-label' || review.model !== 'gpt-6-luna' || review.provider !== 'Codex subagent'
      || review.reasoningEffort !== 'low' || review.humanReviewed !== false || !review.reason?.trim()
      || !/^[a-f0-9]{64}$/.test(review.reviewSha256 || '') || !Number.isFinite(Date.parse(review.reviewedAt))
      || review.sourceBlockSha256 !== sha256(block.en) || review.chineseBlockSha256 !== sha256(block.zh)) {
      throw new Error(`Untranslated heading requires a verified label review: ${paper.id}/${block.id}.`)
    }
  }
}
