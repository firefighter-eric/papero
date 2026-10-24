import { describe, expect, it } from 'vitest'
import registry from '../paper-metadata/tags.json'
import collection from '../paper-metadata/collections/artificial-analysis-benchmarks-22.json'
import { browseHref, matchesPaperCategory } from '../src/lib/paper-categories'
import { classificationTags, matchesPaperFilters, paperFamilyFilterGroups } from '../src/lib/paper-tags'
import type { CatalogPaper } from '../src/types'

const paper = (id: string, title: string, tags: string[]): CatalogPaper => ({
  id, title, tags, titleZh: null, authors: [], arxivId: null, year: 2026,
  sourceUrl: '', sourceHtmlUrl: '', translationStatus: 'machine',
  blockCount: 1, sectionCount: 1, dataPath: `papers/${id}/paper.json`,
})

describe('benchmark reading collection', () => {
  it('collects all 22 approved papers through their explicit benchmark tag', () => {
    for (const item of collection.papers) {
      const tags = registry.papers[item.id as keyof typeof registry.papers]
      const entry = paper(item.id, item.title, tags)
      expect(matchesPaperCategory(entry, 'benchmarks'), item.id).toBe(true)
      expect(matchesPaperFilters(entry, '', '', '评测基准'), item.id).toBe(true)
      expect(matchesPaperFilters(entry, '', 'benchmarks', ''), item.id).toBe(true)
      expect(classificationTags(tags), item.id).toContain('评测基准')
    }
  })

  it('does not confuse papers that run evaluations or build pretraining corpora with benchmark papers', () => {
    expect(matchesPaperCategory(paper('model', 'A model report with benchmark evaluations', ['Qwen', '预训练']), 'benchmarks')).toBe(false)
    expect(matchesPaperCategory(paper('fineweb-datasets', 'The FineWeb Datasets', registry.papers['fineweb-datasets']), 'benchmarks')).toBe(false)
  })

  it('finds the common collection with Chinese and English benchmark aliases', () => {
    const entry = paper('humanitys-last-exam', "Humanity's Last Exam", ['评测基准', 'Artificial Analysis'])
    for (const query of ['benchmark', 'BENCHMARKS', 'evaluation', '能力评测']) {
      expect(matchesPaperFilters(entry, query, '', '评测基准')).toBe(true)
    }
    expect(matchesPaperFilters(entry, 'benchmark', 'Qwen', '评测基准')).toBe(false)
  })

  it('keeps benchmark category and search context when returning from a paper', () => {
    const params = new URLSearchParams('category=benchmarks&paper=gdpval&q=health&sort=year')
    expect(browseHref(params, {})).toBe('/?category=benchmarks&q=health&sort=year')
  })

  it('offers broad directions instead of one menu item per algorithm', () => {
    const entries = [
      paper('qwen', 'Qwen report', ['Qwen', '模型架构']),
      paper('benchmark', 'Benchmark', ['评测基准']),
      paper('adam', 'Adam', ['Adam', '优化器']),
      paper('ppo', 'PPO', ['PPO', '强化学习']),
      paper('dreamer', 'Dreamer', ['Dreamer', '强化学习', '世界模型']),
    ]
    const groups = paperFamilyFilterGroups(entries)
    expect(groups.map(group => group.label)).toEqual(['模型系列', '研究方向'])
    const values = groups.flatMap(group => group.options.map(option => option.value))
    expect(values).toEqual(['Qwen', 'benchmarks', 'optimization', 'reinforcement-learning', 'architecture'])
    expect(matchesPaperFilters(entries[2], '', 'optimization', '')).toBe(true)
    expect(matchesPaperFilters(entries[3], '', 'reinforcement-learning', '')).toBe(true)
    expect(matchesPaperFilters(entries[4], 'dreamer', 'reinforcement-learning', '')).toBe(true)
    expect(matchesPaperFilters(entries[0], '', 'optimization', '')).toBe(false)
  })

  it('retains a selected legacy method link without listing every method again', () => {
    const entry = paper('adam', 'Adam', ['Adam', '优化器'])
    expect(paperFamilyFilterGroups([entry]).flatMap(group => group.options.map(option => option.value))).toEqual(['optimization'])
    expect(paperFamilyFilterGroups([entry], 'Adam').at(-1)).toEqual({ label: '当前筛选', options: [{ value: 'Adam', label: 'Adam' }] })
    expect(matchesPaperFilters(entry, '', 'Adam', '')).toBe(true)
  })
})
