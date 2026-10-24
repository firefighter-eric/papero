import type { CatalogPaper } from '../types'
import { paperAuthors } from './paper-bibliography'
import { PAPER_CATEGORIES } from './paper-categories'

export const PAPER_FAMILIES = [
  'Qwen', 'DeepSeek', 'Kimi', 'MiniMax', 'Gemini', 'Gemma', 'Chinchilla', 'Transformer',
  'Llama', 'OLMo', 'GPT', 'BERT', 'T5', 'Falcon', 'CLIP',
  'FineWeb', 'DCLM', 'DoReMi', 'Scaling Laws', 'μP', 'Dolma', 'Switch Transformer',
  'Adam', 'AdamW', 'Muon', 'Shampoo', 'SOAP', 'Adafactor', 'Lion', 'Dion',
  'AlexNet', 'ResNet', 'Word2Vec', 'Seq2Seq', 'Attention', 'VAE', 'GAN', 'DDPM', 'ViT', 'DQN', 'AlphaGo', 'InstructGPT',
  'TD learning', 'Q-learning', 'REINFORCE', 'Dyna', 'Options', 'Policy Gradient Theorem', 'Apprenticeship IRL', 'Maximum Entropy IRL', 'Deep RL from Human Preferences', 'Double DQN', 'Dueling DQN', 'Prioritized Experience Replay', 'Rainbow', 'C51', 'QR-DQN', 'IQN',
  'DPG', 'TRPO', 'GAE', 'PPO', 'A3C', 'DDPG', 'TD3', 'SAC', 'AlphaZero', 'MuZero', 'World Models', 'PETS', 'MBPO', 'Dreamer', 'DreamerV2', 'DreamerV3',
  'BCQ', 'CQL', 'IQL', 'Decision Transformer', 'ICM', 'RND', 'HER', 'Option-Critic', 'MADDPG', 'VDN', 'QMIX', 'GAIL', 'DPO',
] as const
export const RESEARCH_TAGS = ['预训练', '后训练', '评测基准', '模型架构', '监督训练', '缩放定律', '预训练数据', '数据混合', '训练优化', '优化器', '矩阵优化', '显存优化', '分布式训练', '经典论文', '计算机视觉', '自然语言处理', '生成模型', '强化学习', '强化学习基础', '价值学习', '回报分布', '策略梯度', '连续控制', '世界模型', '规划', '离线强化学习', '探索', '稀疏奖励', '层次强化学习', '多智能体', '模仿学习', '逆强化学习', '偏好优化', 'RLHF'] as const

export function tagLabel(tag: string): string {
  return tag === 'Qwen' ? 'Qwen / 千问' : tag
}

const MODEL_FAMILY_FILTERS = ['Qwen', 'DeepSeek', 'Kimi', 'MiniMax', 'Gemini', 'Gemma', 'Chinchilla', 'Llama', 'OLMo', 'GPT', 'BERT', 'T5', 'Falcon'] as const
const DIRECTION_FILTERS = ['benchmarks', 'optimization', 'data', 'vision', 'nlp', 'generative', 'reinforcement-learning', 'architecture', 'scaling']
  .map(id => PAPER_CATEGORIES.find(category => category.id === id)!)

export function paperFamilyFilterGroups(papers: CatalogPaper[], selected = '') {
  const tags = new Set(papers.flatMap(paper => paper.tags))
  const groups = [
    { label: '模型系列', options: MODEL_FAMILY_FILTERS.filter(tag => tags.has(tag)).map(value => ({ value: String(value), label: tagLabel(value) })) },
    { label: '研究方向', options: DIRECTION_FILTERS.filter(category => category.tags.some(tag => tags.has(tag)))
      .map(category => ({ value: String(category.id), label: category.id === 'benchmarks' ? 'Benchmark / 评测基准' : category.title })) },
  ].filter(group => group.options.length)
  // Keep an existing shared link precise without restoring the long method menu.
  if (selected && tags.has(selected) && !groups.some(group => group.options.some(option => option.value === selected))) {
    groups.push({ label: '当前筛选', options: [{ value: selected, label: tagLabel(selected) }] })
  }
  return groups
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
  评测基准: 'benchmark benchmarks evaluation evaluations 测评 基准评测 能力评测',
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
  const direction = DIRECTION_FILTERS.find(category => category.id === family)
  if (family && !(direction ? direction.tags.some(tag => paper.tags.includes(tag)) : paper.tags.includes(family))) return false
  if (research && !paper.tags.includes(research)) return false
  const searchText = [paper.title, paper.titleZh, ...paperAuthors(paper), ...paper.authors, ...paper.tags,
    ...paper.tags.map(tag => searchAliases[tag] ?? ''), paper.arxivId, paper.year]
    .filter(Boolean).join(' ').toLocaleLowerCase()
  return searchText.includes(query.trim().toLocaleLowerCase())
}
