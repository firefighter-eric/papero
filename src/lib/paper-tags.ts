import type { CatalogPaper } from '../types'

export const PAPER_FAMILIES = ['Qwen', 'DeepSeek', 'Kimi', 'MiniMax', 'Transformer'] as const
export const RESEARCH_TAGS = ['预训练', '后训练', '模型架构', '监督训练'] as const

export function tagLabel(tag: string): string {
  return tag === 'Qwen' ? 'Qwen / 千问' : tag
}

export function classificationTags(tags: string[]): string[] {
  return [...PAPER_FAMILIES, ...RESEARCH_TAGS].filter(tag => tags.includes(tag))
}

const searchAliases: Record<string, string> = {
  Qwen: '千问 通义千问',
  DeepSeek: '深度求索',
  预训练: 'pretraining pre-training',
  后训练: 'posttraining post-training',
  模型架构: 'architecture',
  监督训练: 'supervised training',
}

export function matchesPaperFilters(paper: CatalogPaper, query: string, family: string, research: string): boolean {
  if (family && !paper.tags.includes(family)) return false
  if (research && !paper.tags.includes(research)) return false
  const searchText = [paper.title, paper.titleZh, ...paper.authors, ...paper.tags,
    ...paper.tags.map(tag => searchAliases[tag] ?? ''), paper.arxivId, paper.year]
    .filter(Boolean).join(' ').toLocaleLowerCase()
  return searchText.includes(query.trim().toLocaleLowerCase())
}
