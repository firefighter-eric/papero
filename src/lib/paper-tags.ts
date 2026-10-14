import type { CatalogPaper } from '../types'
import { paperAuthors } from './paper-bibliography'

export const PAPER_FAMILIES = [
  'Qwen', 'DeepSeek', 'Kimi', 'MiniMax', 'Gemini', 'Gemma', 'Chinchilla', 'Transformer',
  'Llama', 'OLMo', 'GPT', 'BERT', 'T5', 'Falcon', 'CLIP',
  'FineWeb', 'DCLM', 'DoReMi', 'Scaling Laws', 'μP', 'Dolma', 'Switch Transformer',
  'Adam', 'AdamW', 'Muon', 'Shampoo', 'SOAP', 'Adafactor', 'Lion', 'Dion',
  'AlexNet', 'ResNet', 'Word2Vec', 'Seq2Seq', 'Attention', 'VAE', 'GAN', 'DDPM', 'ViT', 'DQN', 'AlphaGo', 'InstructGPT',
] as const
export const RESEARCH_TAGS = ['预训练', '后训练', '模型架构', '监督训练', '缩放定律', '预训练数据', '数据混合', '训练优化', '优化器', '矩阵优化', '显存优化', '分布式训练', '经典论文', '计算机视觉', '自然语言处理', '生成模型', '强化学习'] as const

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
  AdamW: 'decoupled weight decay 解耦 权重衰减',
  Muon: 'Moonlight Polar Express 正交化 牛顿舒尔茨 Newton-Schulz',
  Shampoo: 'preconditioner 预条件',
  SOAP: 'Shampoo Adam preconditioner 预条件',
  Adafactor: 'factorization 分解 内存 显存',
  Lion: 'symbolic discovery 符号发现 sign 符号更新',
  Dion: 'distributed orthonormalized 分布式 正交化',
  AlexNet: 'ImageNet 卷积神经网络 CNN',
  ResNet: 'residual learning 残差网络',
  Word2Vec: 'word embeddings 词向量',
  Seq2Seq: 'sequence to sequence 序列到序列',
  Attention: 'Bahdanau 注意力',
  VAE: 'variational autoencoder 变分自编码器',
  GAN: 'generative adversarial 生成对抗网络',
  DDPM: 'denoising diffusion 扩散模型',
  ViT: 'vision transformer 视觉 Transformer',
  DQN: 'deep Q network 深度 Q 网络',
  AlphaGo: '围棋 蒙特卡洛树搜索',
  InstructGPT: 'instruction tuning 指令微调 RLHF 人类反馈',
  经典论文: 'classic seminal foundational',
  计算机视觉: 'computer vision',
  自然语言处理: 'natural language processing NLP',
  生成模型: 'generative modeling',
  强化学习: 'reinforcement learning',
  预训练: 'pretraining pre-training',
  后训练: 'posttraining post-training',
  模型架构: 'architecture',
  监督训练: 'supervised training',
  缩放定律: 'scaling laws scaling-laws',
  预训练数据: 'pretraining data pre-training data dataset corpus 数据集 语料',
  数据混合: 'data mixing data mixture domain reweighting',
  训练优化: 'training optimization hyperparameter transfer 超参数',
  优化器: 'optimizer optimization 优化算法',
  矩阵优化: 'matrix optimization orthogonalization 正交化',
  显存优化: 'memory efficient sublinear memory 内存优化',
  分布式训练: 'distributed training communication 通信',
}

export function matchesPaperFilters(paper: CatalogPaper, query: string, family: string, research: string): boolean {
  if (family && !paper.tags.includes(family)) return false
  if (research && !paper.tags.includes(research)) return false
  const searchText = [paper.title, paper.titleZh, ...paperAuthors(paper), ...paper.authors, ...paper.tags,
    ...paper.tags.map(tag => searchAliases[tag] ?? ''), paper.arxivId, paper.year]
    .filter(Boolean).join(' ').toLocaleLowerCase()
  return searchText.includes(query.trim().toLocaleLowerCase())
}
