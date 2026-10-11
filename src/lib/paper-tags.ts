import type { CatalogPaper } from '../types'
import { paperAuthors } from './paper-bibliography'

export const PAPER_FAMILIES = [
  'Qwen', 'DeepSeek', 'Kimi', 'MiniMax', 'Gemini', 'Gemma', 'Chinchilla', 'Transformer',
  'Llama', 'OLMo', 'GPT', 'BERT', 'T5', 'Falcon', 'CLIP',
  'FineWeb', 'DCLM', 'DoReMi', 'Scaling Laws', 'μP', 'Dolma', 'Switch Transformer',
] as const
export const RESEARCH_TAGS = ['预训练', '后训练', '模型架构', '监督训练', '缩放定律', '预训练数据', '数据混合', '训练优化'] as const

export function tagLabel(tag: string): string {
  return tag === 'Qwen' ? 'Qwen / 千问' : tag
}

export function classificationTags(tags: string[]): string[] {
  return [...PAPER_FAMILIES, ...RESEARCH_TAGS].filter(tag => tags.includes(tag))
}

const searchAliases: Record<string, string> = {
  Qwen: '千问 通义千问',
  DeepSeek: '深度求索',
  Gemini: '谷歌 Google',
  Gemma: '谷歌 Google',
  Chinchilla: 'Chillchila DeepMind Google 谷歌',
  Llama: 'Meta 脸书',
  OLMo: 'Olmo 艾伦 AI2 Allen Institute for AI',
  GPT: 'OpenAI',
  BERT: '谷歌 Google',
  T5: '谷歌 Google text-to-text',
  Falcon: 'RefinedWeb TII Technology Innovation Institute',
  CLIP: 'OpenAI contrastive language-image',
  FineWeb: 'Hugging Face FineWeb-Edu',
  DCLM: 'DataComp-LM DataComp for Language Models',
  DoReMi: 'domain reweighting data mixture',
  'Scaling Laws': 'Kaplan OpenAI',
  'μP': 'muP mup muTransfer maximal update parametrization 最大更新参数化',
  Dolma: 'AI2 Allen Institute for AI 艾伦',
  'Switch Transformer': 'Switch Transformers 谷歌 Google',
  预训练: 'pretraining pre-training',
  后训练: 'posttraining post-training',
  模型架构: 'architecture',
  监督训练: 'supervised training',
  缩放定律: 'scaling laws scaling-laws',
  预训练数据: 'pretraining data pre-training data dataset corpus 数据集 语料',
  数据混合: 'data mixing data mixture domain reweighting',
  训练优化: 'training optimization hyperparameter transfer 超参数',
}

export function matchesPaperFilters(paper: CatalogPaper, query: string, family: string, research: string): boolean {
  if (family && !paper.tags.includes(family)) return false
  if (research && !paper.tags.includes(research)) return false
  const searchText = [paper.title, paper.titleZh, ...paperAuthors(paper), ...paper.authors, ...paper.tags,
    ...paper.tags.map(tag => searchAliases[tag] ?? ''), paper.arxivId, paper.year]
    .filter(Boolean).join(' ').toLocaleLowerCase()
  return searchText.includes(query.trim().toLocaleLowerCase())
}
