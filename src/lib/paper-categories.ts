import type { CatalogPaper } from '../types'

export const PAPER_CATEGORIES = [
  { id: 'classics', title: '经典论文', description: '从基础方法读起，回看 AI 的关键进展。', tags: ['经典论文'] },
  { id: 'language-models', title: '大语言模型', description: '模型系列、技术报告与训练方法。', tags: ['Qwen', 'DeepSeek', 'Kimi', 'MiniMax', 'Gemini', 'Gemma', 'Llama', 'OLMo', 'GPT', 'BERT', 'T5', 'Chinchilla', 'Switch Transformer'] },
  { id: 'benchmarks', title: '评测与 Benchmark', description: '集中阅读知识、推理、代码、智能体及专业领域的评测基准。', tags: ['评测基准'] },
  { id: 'vision', title: '计算机视觉与多模态', description: '从图像识别到视觉语言模型。', tags: ['计算机视觉', '多模态', '视觉语言模型', 'CLIP'] },
  { id: 'nlp', title: '自然语言处理', description: '词向量、序列建模与机器翻译。', tags: ['自然语言处理', '机器翻译', '词向量', 'BERT', 'T5'] },
  { id: 'generative', title: '生成模型', description: '变分自编码器、对抗学习与扩散模型。', tags: ['生成模型'] },
  { id: 'reinforcement-learning', title: '强化学习', description: '价值学习、策略梯度、探索与智能体决策。', tags: ['强化学习'] },
  { id: 'world-models', title: '世界模型与规划', description: '环境模型、潜在想象与搜索规划。', tags: ['世界模型', '规划', '树搜索'] },
  { id: 'offline-rl', title: '离线强化学习与模仿', description: '从固定数据、专家示范与奖励推断中学习。', tags: ['离线强化学习', '模仿学习', '逆强化学习'] },
  { id: 'multi-agent', title: '多智能体与层次学习', description: '协作、竞争和不同时间尺度的决策。', tags: ['多智能体', '层次强化学习', '时间抽象'] },
  { id: 'alignment', title: '后训练与偏好对齐', description: '指令微调、人类反馈与偏好优化。', tags: ['后训练', 'RLHF', '指令微调', '偏好优化'] },
  { id: 'architecture', title: '模型架构', description: '注意力、Transformer 与混合专家。', tags: ['模型架构', '注意力机制', 'MoE', 'Transformer'] },
  { id: 'data', title: '数据与语料', description: '数据集构建、筛选与数据混合。', tags: ['预训练数据', '数据混合'] },
  { id: 'scaling', title: '缩放定律', description: '理解模型规模、数据与计算的关系。', tags: ['缩放定律'] },
  { id: 'optimization', title: '训练与优化器', description: '优化算法、显存效率与分布式训练。', tags: ['训练优化', '优化器', '矩阵优化', '显存优化', '分布式训练'] },
] as const

export function matchesPaperCategory(paper: CatalogPaper, category: string): boolean {
  const definition = PAPER_CATEGORIES.find(item => item.id === category)
  return !definition || definition.tags.some(tag => paper.tags.includes(tag))
}

export function browseHref(params: URLSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(params)
  next.delete('paper'); next.delete('research')
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  const query = next.toString()
  return query ? `/?${query}` : '/'
}
