import { describe, expect, it } from 'vitest'
import registry from '../paper-metadata/tags.json'
import { matchesPaperCategory } from '../src/lib/paper-categories'
import type { CatalogPaper } from '../src/types'

function paper(id: keyof typeof registry.papers): CatalogPaper {
  return { id, arxivId: null, title: id, titleZh: null, authors: [], year: 2020,
    tags: registry.papers[id], sourceUrl: '', sourceHtmlUrl: '', translationStatus: 'pending',
    blockCount: 0, sectionCount: 0, dataPath: `papers/${id}/paper.json` }
}

describe('reinforcement-learning collection boundaries', () => {
  it('finds classic methods through their distinct reading categories', () => {
    expect(matchesPaperCategory(paper('ppo'), 'reinforcement-learning')).toBe(true)
    expect(matchesPaperCategory(paper('dreamerv3'), 'world-models')).toBe(true)
    expect(matchesPaperCategory(paper('cql'), 'offline-rl')).toBe(true)
    expect(matchesPaperCategory(paper('qmix'), 'multi-agent')).toBe(true)
    expect(matchesPaperCategory(paper('options'), 'multi-agent')).toBe(true)
    expect(matchesPaperCategory(paper('alphazero'), 'world-models')).toBe(true)
    expect(registry.papers.alphazero).not.toContain('世界模型')
  })
  it('keeps preference optimization distinct from online reinforcement learning', () => {
    expect(matchesPaperCategory(paper('dpo'), 'alignment')).toBe(true)
    expect(matchesPaperCategory(paper('dpo'), 'reinforcement-learning')).toBe(false)
    expect(matchesPaperCategory(paper('deep-human-preferences'), 'reinforcement-learning')).toBe(true)
  })
  it('does not label Double DQN, Dueling DQN or replay prioritization as distributional value methods', () => {
    for (const id of ['double-dqn','dueling-dqn','prioritized-experience-replay'] as const) {
      expect(registry.papers[id]).not.toContain('回报分布')
    }
    expect(registry.papers['c51']).toContain('回报分布')
  })
})
