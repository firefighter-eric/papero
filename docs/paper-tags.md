# 论文标签

核验日期：2026-10-11。标签描述报告实际介绍的模型系列、训练阶段或研究主题。预训练和后训练可以同时出现，表示报告覆盖两个阶段，不是互斥的论文类别。标签核验不等于全篇译文经过人工审校；机器翻译的来源与 `humanReviewed: false` 保持不变。

核心分类由 [`paper-metadata/tags.json`](../paper-metadata/tags.json) 统一维护。现有的 MoE、视觉语言模型、强化学习等主题标签继续保留，合并时去除重复项。未登记论文不会根据相近模型名猜测训练阶段。

| 论文 | 核心标签 | 官方来源与证据位置 |
| --- | --- | --- |
| Attention Is All You Need | Transformer、模型架构、监督训练 | [1706.03762v7](https://arxiv.org/html/1706.03762v7)：§3 模型架构；§5 监督机器翻译训练。 |
| Qwen2 | Qwen、预训练、后训练 | [2407.10671v4](https://arxiv.org/html/2407.10671v4)：§3 预训练；§4 后训练。 |
| Qwen2.5 | Qwen、预训练、后训练 | [2412.15115v2](https://arxiv.org/html/2412.15115v2)：§3 预训练；§4 后训练。 |
| Qwen2.5-VL | Qwen、预训练、后训练 | [2502.13923v1](https://arxiv.org/html/2502.13923v1)：§2.2 预训练；§2.3 后训练。 |
| Qwen3 | Qwen、预训练、后训练 | [2505.09388v1](https://arxiv.org/html/2505.09388v1)：§3 预训练；§4 后训练。 |
| Qwen3-VL | Qwen、预训练、后训练 | [2511.21631v2](https://arxiv.org/html/2511.21631v2)：§3 预训练；§4 后训练。 |
| Qwen3.5 官方文章 | Qwen、预训练、后训练 | [官方发布文章](https://qwen.ai/blog?id=qwen3.5)：原生多模态预训练及强化学习后训练的说明。此条仍标注为官方文章。 |
| DeepSeek V3 | DeepSeek、预训练、后训练 | [2412.19437v2](https://arxiv.org/html/2412.19437v2)：§4 预训练；§5 后训练。 |
| DeepSeek R1 | DeepSeek、后训练 | [2501.12948v2](https://arxiv.org/html/2501.12948v2)：§2 强化学习与后训练方法；§3 实验。以既有基础模型为起点，不因此添加预训练标签。 |
| DeepSeek V4 | DeepSeek、预训练、后训练 | [2606.19348v1](https://arxiv.org/html/2606.19348v1)：§4 预训练；§5 后训练。 |
| Kimi K2 | Kimi、预训练、后训练 | [2507.20534v2](https://arxiv.org/html/2507.20534v2)：§2 预训练；§3 后训练。 |
| Kimi K2.5 | Kimi、预训练、后训练 | [2602.02276v2](https://arxiv.org/html/2602.02276v2)：§2 预训练；§4.4 后训练。 |
| Kimi K3 | Kimi、预训练、后训练 | [2607.24653v2](https://arxiv.org/html/2607.24653v2)：§3 预训练；§4 后训练。 |
| MiniMax Sparse Attention | MiniMax、模型架构、预训练 | [2606.13392v2](https://arxiv.org/html/2606.13392v2)：§5 PT / CPT 实验；§7 中 RL 为未来工作，不标后训练。原题和 M3 关联架构论文身份继续保留。 |
| Gemini 1.0 | Gemini、预训练、后训练 | [2312.11805v5](https://arxiv.org/html/2312.11805v5)：§4 预训练数据；§6 后训练模型。 |
| Gemini 1.5 | Gemini、预训练、后训练 | [2403.05530v5](https://arxiv.org/html/2403.05530v5)：§4 训练与数据；§9.3.1 预训练、§9.3.2 监督微调。 |
| Gemini 2.5 | Gemini、预训练、后训练 | [2507.06261v6](https://arxiv.org/html/2507.06261v6)：§2 模型训练与数据；§2.4 后训练。报告同时介绍 Gemini 2.0，不重复收录同一报告。 |
| Gemma 1 | Gemma、预训练、后训练 | [2403.08295v4](https://arxiv.org/html/2403.08295v4)：§4 预训练；§5 指令微调。 |
| Gemma 2 | Gemma、预训练、后训练 | [2408.00118v3](https://arxiv.org/html/2408.00118v3)：§3 预训练；§4 后训练。 |
| Gemma 3 | Gemma、预训练、后训练 | [2503.19786v1](https://arxiv.org/html/2503.19786v1)：§2.2 预训练；§3 指令微调。 |
| Gemma 4 | Gemma、预训练、后训练 | [2607.02770v2](https://arxiv.org/html/2607.02770v2)：§2.4 预训练；§3 指令微调。 |
| Training Compute-Optimal Large Language Models（Chinchilla） | Chinchilla、预训练、缩放定律 | [2203.15556v1](https://arxiv.org/html/2203.15556v1)：§1 建模最终预训练损失；§3 估计固定计算预算下参数量与训练 token 的最优分配及缩放关系；§4–4.1 介绍 Chinchilla 的训练。[DeepMind 官方说明](https://deepmind.google/blog/an-empirical-analysis-of-compute-optimal-large-language-model-training/)确认模型与计算最优缩放研究的关联。 |
| The Llama 3 Herd of Models | Llama、预训练、后训练、缩放定律；多模态 | [2407.21783v3](https://arxiv.org/html/2407.21783v3)：§3 预训练与 §3.2.1 缩放；§4 后训练；§7–8 视觉与语音。 |
| 2 OLMo 2 Furious | OLMo、预训练、后训练、预训练数据、数据混合、训练优化 | [2501.00656v3](https://arxiv.org/html/2501.00656v3)：§2.3–2.4 训练与数据；§3 稳定性；§4 Dolmino 混合；§5 后训练。 |
| The FineWeb Datasets | FineWeb、预训练、预训练数据 | [2406.17557v2](https://arxiv.org/html/2406.17557v2)：§3 清洗、过滤与去重；§4 FineWeb-Edu；附录 D 预训练消融。 |
| DataComp-LM | DCLM、预训练、后训练、预训练数据、数据混合 | [2406.11794v4](https://arxiv.org/html/2406.11794v4)：§3–4 数据筛选基准与 §4.5 混合；§5 预训练；附录 P/Q 明确实施指令微调。 |
| DoReMi | DoReMi、预训练、数据混合、训练优化 | [2305.10429v4](https://arxiv.org/html/2305.10429v4)：§2 使用小代理模型学习域权重后训练大模型；§3–4 效率与消融。 |
| Scaling Laws for Neural Language Models | Scaling Laws、预训练、缩放定律 | [2001.08361v1](https://arxiv.org/html/2001.08361v1)：§2 语言模型训练；§3–5 参数、数据、计算缩放；§6 预算分配。 |
| DeepSeekMoE | DeepSeek、模型架构、预训练、后训练；MoE | [2401.06066v1](https://arxiv.org/html/2401.06066v1)：§3 专家划分与共享专家；§4–5 预训练；§6 实际进行 SFT 对齐，不能仅标预训练。 |
| Tensor Programs V（μP / μTransfer） | μP、预训练、训练优化 | [2203.03466v2](https://arxiv.org/html/2203.03466v2)：摘要及实验比较从小模型迁移预训练超参数，降低 BERT/GPT 调参成本；不是 BERT/GPT 系列报告。 |
| Olmo 3 | OLMo、预训练、后训练、预训练数据、数据混合 | [2512.13961v2](https://arxiv.org/html/2512.13961v2)：§3.4–3.6 预训练、中期训练与长上下文；§4–5 Think/Instruct 的 SFT、DPO 与 RL。 |
| LLaMA | Llama、预训练、后训练 | [2302.13971v1](https://arxiv.org/html/2302.13971v1)：§2.1 预训练数据；§4 实际进行指令微调并评估 LLaMA-I。 |
| Llama 2 | Llama、预训练、后训练 | [2307.09288v2](https://arxiv.org/html/2307.09288v2)：§2 预训练；§3 SFT 与人类反馈强化学习；§4 安全微调。 |
| DeepSeek LLM | DeepSeek、预训练、后训练、缩放定律 | [2401.02954v1](https://arxiv.org/html/2401.02954v1)：§2 预训练；§3 缩放关系；§4 SFT 与 DPO。 |
| Language Models are Unsupervised Multitask Learners（GPT-2） | GPT、预训练 | [OpenAI 官方 PDF](https://cdn.openai.com/better-language-models/language-models.pdf)：§2 方法、WebText 与模型；§3 零样本评估。是官方论文，未冒充 arXiv 报告。 |
| Language Models are Few-Shot Learners（GPT-3） | GPT、预训练 | [2005.14165v4](https://arxiv.org/html/2005.14165v4)：§2.2–2.3 训练数据与训练流程；少样本上下文学习没有梯度更新，不等于后训练。 |
| BERT | BERT、预训练、监督训练 | [1810.04805v2](https://arxiv.org/html/1810.04805v2)：§3.1 MLM/NSP 预训练；§3.2 下游任务监督微调。 |
| Unified Text-to-Text Transformer（T5） | T5、预训练、监督训练、预训练数据 | [1910.10683v4](https://arxiv.org/html/1910.10683v4)：§2.2 C4；§3.3–3.4 预训练目标与数据；§3.5 下游监督迁移。 |
| The RefinedWeb Dataset for Falcon LLM | Falcon、预训练、预训练数据 | [2306.01116v1](https://arxiv.org/html/2306.01116v1)：§3 过滤、去重流水线；§4 预训练消融；附录 B Falcon-RW 模型卡。 |
| Dolma | Dolma、预训练、预训练数据、数据混合 | [2402.00159v2](https://arxiv.org/html/2402.00159v2)：§4 数据整理；§8–9 汇集数据与训练；附录 M 混合和上采样。 |
| Switch Transformers | Switch Transformer、模型架构、预训练、监督训练、训练优化；MoE | [2101.03961v3](https://arxiv.org/html/2101.03961v3)：§2 路由与稳定训练；§3 预训练效率；§4.1 下游任务微调。 |
| CLIP | CLIP、预训练；多模态、对比学习 | [2103.00020v1](https://arxiv.org/html/2103.00020v1)：§2.2 图文数据；§2.3 对比式预训练；§2.5 训练；§3.1 零样本迁移。 |

Attention 的监督机器翻译训练没有沿用当前大语言模型的预训练／后训练阶段划分，因此使用监督训练标签。

Gemini 与 Gemma 是独立系列，家族筛选只读取显式标签。Gemma 1 的标题含有 Gemini，不会因此归入 Gemini；搜索 Google／谷歌可同时找到两个系列。

Chinchilla 也是独立系列，仅为 `chinchilla-training-compute-optimal` 显式登记“Chinchilla、预训练、缩放定律”。原论文标题不含 Chinchilla，仍可通过系列标签搜索；Chillchila 是用户输入的检索别名，DeepMind／Google／谷歌是来源机构的检索别名，不改变原题或作者。其他论文引用 Chinchilla 或讨论缩放关系，不会因此自动获得该系列或研究标签。缩放定律可作为研究类别筛选；与预训练组合时，可选择预训练类别并搜索“缩放定律”或“scaling laws”。论文提到下游微调成本，不据此添加后训练标签。

数据和方法论文也登记自身系列：FineWeb、DCLM、DoReMi、Dolma、Scaling Laws 与 μP。引用 Llama、BERT 或 GPT 的实验不会让它们归入这些模型系列。RefinedWeb 明确是 Falcon 的预训练数据报告，使用 Falcon 系列；Switch 使用自己的架构系列。μP 可通过 muP、mup、muTransfer 或“最大更新参数化”检索，DCLM 可通过 DataComp-LM 检索。

“预训练数据”“数据混合”“训练优化”可在研究类别中筛选。MoE、多模态和对比学习继续作为独立主题标签，可与系列和研究类别一起搜索。BERT、T5 与 Switch 的下游监督任务微调使用“监督训练”，与本文中指令／偏好对齐的“后训练”区分；GPT-2/3 和 CLIP 的零样本或上下文少样本评估不因此获得后训练标签。LLaMA 1、DeepSeekMoE 和 DCLM 的正文或附录确实训练了指令／对齐版本，因此同时标注后训练。

## 导入与发布

`scripts/paper-tags.mjs` 在首次导入和公共导出时合并标签。导出先校验输入文件与正文指纹，再在导出副本的目录和 `paper.json` 上应用同一分类；已有独立 `en.html` / `zh.html` 直接复制，不重写正文、公式、翻译来源或模型参数。只有元数据文件的字节指纹会变化。

本地原始 checkpoint 与已经冻结的 Codex 翻译 manifest 不会被改写。其身份包含原始标签，继续翻译时仍使用原始快照；公共导出会补上当前分类。来源入口的 `source-only` 条目只更新目录中的标签，正文、译文和本地文件继续不参与公开导出。

新增论文应先核验固定版本正文中实际覆盖的阶段，再更新注册表与此表的来源定位。注册表中的分类是经过来源核验、显式维护的阅读元数据，不在运行时按模型名称自动推断。
