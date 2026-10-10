import { describe, expect, it } from 'vitest'
import { classificationTags, matchesPaperFilters } from '../src/lib/paper-tags'
import type { CatalogPaper } from '../src/types'

const paper = (tags: string[], title = 'Report'): CatalogPaper => ({
  id: 'report', arxivId: '2501.00001v1', title, titleZh: null, authors: ['Team'], year: 2025,
  tags, sourceUrl: 'https://arxiv.org/abs/2501.00001v1', sourceHtmlUrl: 'https://arxiv.org/html/2501.00001v1',
  translationStatus: 'pending', blockCount: 0, sectionCount: 0, dataPath: 'papers/report/paper.json',
})

describe('paper tag filtering', () => {
  it('finds a report in both training phases and intersects phase with family and search', () => {
    const report = paper(['Qwen', '预训练', '后训练'], 'Qwen3 Technical Report')
    expect(matchesPaperFilters(report, '', 'Qwen', '预训练')).toBe(true)
    expect(matchesPaperFilters(report, 'qwen3', 'Qwen', '后训练')).toBe(true)
    expect(matchesPaperFilters(report, '', 'DeepSeek', '后训练')).toBe(false)
    expect(matchesPaperFilters(report, 'qwen2', 'Qwen', '后训练')).toBe(false)
  })

  it('supports Chinese model names and English stage aliases', () => {
    expect(matchesPaperFilters(paper(['Qwen', '后训练']), ' 千问 ', '', '')).toBe(true)
    expect(matchesPaperFilters(paper(['DeepSeek', '后训练']), '深度求索', '', '')).toBe(true)
    expect(matchesPaperFilters(paper(['Qwen', '后训练']), 'POST-TRAINING', '', '')).toBe(true)
  })

  it('does not infer pretraining from a technical report title or a related base model', () => {
    expect(matchesPaperFilters(paper(['DeepSeek', '后训练'], 'DeepSeek R1 Technical Report'), '', '', '预训练')).toBe(false)
    expect(matchesPaperFilters(paper(['Transformer', '模型架构', '监督训练']), '', '', '预训练')).toBe(false)
  })

  it('keeps classification badges distinct from technical topics', () => {
    expect(classificationTags(['MoE', '后训练', 'Qwen', '预训练', 'Qwen2.5'])).toEqual(['Qwen', '预训练', '后训练'])
  })
})
