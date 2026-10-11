import { describe, expect, it } from 'vitest'
import { classificationTags, matchesPaperFilters, PAPER_FAMILIES, RESEARCH_TAGS, tagLabel } from '../src/lib/paper-tags'
import type { CatalogPaper } from '../src/types'
import registry from '../paper-metadata/tags.json'

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

  it('filters Gemini reports by family and training phase with Google aliases', () => {
    const report = paper(['Gemini', '预训练', '后训练', '多模态'], 'Gemini 1.5 Technical Report')
    expect(matchesPaperFilters(report, '谷歌', 'Gemini', '预训练')).toBe(true)
    expect(matchesPaperFilters(report, 'GOOGLE', 'Gemini', '后训练')).toBe(true)
    expect(matchesPaperFilters(report, '', 'Qwen', '后训练')).toBe(false)
    expect(matchesPaperFilters(report, '', 'Gemma', '后训练')).toBe(false)
    expect(classificationTags(report.tags)).toEqual(['Gemini', '预训练', '后训练'])
    expect(tagLabel('Gemini')).toBe('Gemini')
  })

  it('keeps Gemma distinct from Gemini while supporting shared Google aliases', () => {
    const report = paper(['Gemma', '预训练', '后训练'], 'Gemma: Open Models based on Gemini Technology')
    expect(matchesPaperFilters(report, 'Gemini', '', '')).toBe(true)
    expect(matchesPaperFilters(report, '', 'Gemini', '')).toBe(false)
    expect(matchesPaperFilters(report, '谷歌', 'Gemma', '预训练')).toBe(true)
    expect(matchesPaperFilters(report, 'GOOGLE', 'Gemma', '后训练')).toBe(true)
    expect(matchesPaperFilters(report, 'Gemini', 'Gemini', '预训练')).toBe(false)
    expect(classificationTags(report.tags)).toEqual(['Gemma', '预训练', '后训练'])
    expect(tagLabel('Gemma')).toBe('Gemma')
  })

  it('finds the original Chinchilla paper through its explicit family despite its title', () => {
    const report = paper(registry.papers['chinchilla-training-compute-optimal'], 'Training Compute-Optimal Large Language Models')
    expect(matchesPaperFilters(report, 'Chinchilla', 'Chinchilla', '')).toBe(true)
    expect(matchesPaperFilters(report, '', 'Gemini', '')).toBe(false)
    expect(matchesPaperFilters(report, '', 'Gemma', '')).toBe(false)
    expect(PAPER_FAMILIES).toContain('Chinchilla')
    expect(classificationTags(report.tags)).toEqual(['Chinchilla', '预训练', '缩放定律'])

    const related = paper(['Gemini', '预训练'], 'Gemini report citing Chinchilla scaling laws')
    expect(matchesPaperFilters(related, 'Chinchilla', '', '')).toBe(true)
    expect(matchesPaperFilters(related, '', 'Chinchilla', '')).toBe(false)
    expect(matchesPaperFilters(related, '', 'Gemini', '缩放定律')).toBe(false)
  })

  it('supports the requested spelling and publisher aliases without inferring a family', () => {
    const report = paper(registry.papers['chinchilla-training-compute-optimal'], 'Training Compute-Optimal Large Language Models')
    for (const alias of [' Chillchila ', 'DEEPMIND', 'Google', '谷歌']) {
      expect(matchesPaperFilters(report, alias, 'Chinchilla', '预训练')).toBe(true)
    }
    const unrelated = { ...paper(['Gemini', '后训练']), authors: ['Google DeepMind'] }
    expect(matchesPaperFilters(unrelated, 'DeepMind', '', '')).toBe(true)
    expect(matchesPaperFilters(unrelated, 'DeepMind', 'Chinchilla', '')).toBe(false)
    expect(matchesPaperFilters(unrelated, 'Chillchila', '', '')).toBe(false)
  })

  it('intersects pretraining and scaling-law searches and registers only the new paper', () => {
    const report = paper(registry.papers['chinchilla-training-compute-optimal'], 'Training Compute-Optimal Large Language Models')
    expect(RESEARCH_TAGS).toContain('缩放定律')
    expect(matchesPaperFilters(report, 'SCALING LAWS', 'Chinchilla', '预训练')).toBe(true)
    expect(matchesPaperFilters(report, '预训练', 'Chinchilla', '缩放定律')).toBe(true)
    expect(matchesPaperFilters(report, 'PRE-TRAINING', 'Chinchilla', '缩放定律')).toBe(true)
    expect(matchesPaperFilters(report, 'scaling-laws', 'Chinchilla', '后训练')).toBe(false)
    expect(registry.papers['chinchilla-training-compute-optimal']).toEqual(['Chinchilla', '预训练', '缩放定律'])
    for (const [id, tags] of Object.entries(registry.papers)) {
      if (id !== 'chinchilla-training-compute-optimal') {
        expect(tags).not.toContain('Chinchilla')
        expect(tags).not.toContain('缩放定律')
      }
    }
  })
})
