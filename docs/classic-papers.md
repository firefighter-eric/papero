# 经典 AI 论文

本轮收录用户确认的十二篇论文。每篇保留固定版本的完整英文正文，并生成内容块对齐的中文机器译文；原始文件、转换材料和本地模型响应保存在被忽略的工作目录，公开正文使用独立的 `en.html` 和 `zh.html`。

| 论文 | 作者 | 固定官方来源 | 补充的研究主题 |
| --- | --- | --- | --- |
| AlexNet · ImageNet Classification with Deep Convolutional Neural Networks | Alex Krizhevsky、Ilya Sutskever、Geoffrey E. Hinton | [NIPS 2012，卷 25](https://papers.nips.cc/paper_files/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html) | 深层卷积网络、ReLU、GPU 训练与 dropout |
| ResNet · Deep Residual Learning for Image Recognition | Kaiming He、Xiangyu Zhang、Shaoqing Ren、Jian Sun | [1512.03385v1](https://arxiv.org/abs/1512.03385v1) | 残差学习与深层网络优化 |
| Word2Vec · Efficient Estimation of Word Representations in Vector Space | Tomas Mikolov、Kai Chen、Greg Corrado、Jeffrey Dean | [1301.3781v3](https://arxiv.org/abs/1301.3781v3) | 连续词表示、CBOW 与 skip-gram |
| Seq2Seq · Sequence to Sequence Learning with Neural Networks | Ilya Sutskever、Oriol Vinyals、Quoc V. Le | [1409.3215v3](https://arxiv.org/abs/1409.3215v3) | 编码器、解码器与序列学习 |
| Neural Machine Translation by Jointly Learning to Align and Translate | Dzmitry Bahdanau、Kyunghyun Cho、Yoshua Bengio | [1409.0473v7](https://arxiv.org/abs/1409.0473v7) | 学习对齐与神经机器翻译中的注意力 |
| VAE · Auto-Encoding Variational Bayes | Diederik P. Kingma、Max Welling | [1312.6114v11](https://arxiv.org/abs/1312.6114v11) | 重参数化、变分推断与生成建模 |
| GAN · Generative Adversarial Nets | Ian Goodfellow 等八位作者 | [1406.2661v1](https://arxiv.org/abs/1406.2661v1) | 对抗学习与生成建模 |
| Denoising Diffusion Probabilistic Models | Jonathan Ho、Ajay Jain、Pieter Abbeel | [2006.11239v2](https://arxiv.org/abs/2006.11239v2) | 扩散与去噪生成模型 |
| ViT · An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale | Alexey Dosovitskiy 等十二位作者 | [2010.11929v2](https://arxiv.org/abs/2010.11929v2) | 图像 patch 与视觉 Transformer |
| DQN · Human-level control through deep reinforcement learning | Volodymyr Mnih 等作者 | [Nature 518, 529–533 (2015)](https://doi.org/10.1038/nature14236) | 深度 Q 学习、经验回放与 Atari 实验 |
| AlphaGo · Mastering the game of Go with deep neural networks and tree search | David Silver 等作者 | [Nature 529, 484–489 (2016)](https://doi.org/10.1038/nature16961) | 策略网络、价值网络、自博弈与树搜索 |
| InstructGPT · Training language models to follow instructions with human feedback | Long Ouyang 等二十位作者 | [2203.02155v1](https://arxiv.org/abs/2203.02155v1) | 指令微调、奖励模型与人类反馈 |

完整作者名单由固定官方版本核对，保存于每篇轻量元数据。GAN 的 arXiv 摘要页题名为 “Generative Adversarial Networks”，该固定版本 HTML 正文题名为 “Generative Adversarial Nets”；保留正文原题，不视为另一篇论文。

GAN 的原 HTML 把两段作者致谢嵌入标题标签，本轮将致谢完整保留为独立前置信息，题名只保留论文名称。InstructGPT 图 45 的九段 Python 代码在官方 HTML 中被标成普通文本；按固定版本、原节点 ID 和逐段指纹标记为不可翻译的字面代码，并保留原有换行及源码中的格式问题。

## PDF 转换记录

九篇使用固定版本的官方 arXiv HTML。AlexNet、DQN、AlphaGo 使用官方 PDF，经 `convert-pdf.py` 1.4.0、pdfplumber 0.11.9、pypdf 6.10.0 转换为语义英文 HTML。三份布局配方分别位于 `paper-metadata/pdf-recipes/`，绑定以下原始 PDF SHA-256：

| 论文 | 页数 | 内容块 | PDF SHA-256 |
| --- | ---: | ---: | --- |
| AlexNet | 9 | 106 | `90137160c57217953d5f61857e64ca58e85f06e1b13b4f475c918b1b582b9771` |
| DQN | 13 | 137 | `3ae04e292f2882483ad539e24cd532743165afce51d45df4e31bd1e3ed9753bb` |
| AlphaGo | 20 | 231 | `9c9184385a3d37b4f4e9d9715270986c43172747b1d08f29093128c1ef878b60` |

逐页核对了阅读顺序、图表边界、脚注、参考文献和内部链接；来源字符覆盖检查没有遗漏或重复。正文块记录 PDF 页码，元数据记录抓取时间、英文 HTML、配方与转换工具指纹。

可可靠转写的公式采用 MathML；其余公式通过 pdftocairo 26.05.0 和 `pdf_vector_math.py` 1.1.0 保留原始 PDF 数学字形及线条。正文、算法、图注和引用保持语义 HTML。此矢量回退不提供公式语义检索，也不使用整页截图代替正文。

DQN 第 10–13 页的四张补充表格，以及 AlphaGo 第 13 页的补充表格，缺少可用的文字层，使用 macOS Apple Vision `VNRecognizeTextRequest`：300 dpi、`accurate`、`en-US`、关闭语言纠错。识别结果与渲染的原始表格逐行逐格对照；DQN 的实验表保留全部 49 款游戏。AlphaGo 最后三页的胜率矩阵使用原生 PDF 行文本和原始标签矢量恢复，避免列边界切断数字。OCR 没有调用千问模型。

## 翻译与核验

主译复用 LM Studio 已安装的 `mlx-community/Qwen3.6-35B-A3B-4bit`，API 标识为 `qwen3.6-35b-a3b`。初轮上下文为 8192，续跑为 16384，`reasoning_effort: none`，全局最多四个请求；实际采样参数、提示词指纹、模型身份及响应分别记录。没有下载新的模型权重。

翻译时冻结公式、代码、图像、链接、引用和数值；校验失败的片段由同一本地模型定向重译。中英文使用相同内容块 ID、章节顺序与锚点。原始模型响应和续跑检查点不进入公开数据。

反复失败的数字和引用接缝使用当前 Codex 会话提供的参考片段，再由千问生成最终响应。参考记录单独保留输入、草稿和修正指令指纹；当前会话的具体模型变体未对执行端公开，记录为 GPT-6 系列，不冒充 Luna 子代理，不推测 API token 消耗。AlexNet 作者栏的边界修复只替换了两段不可变的邮箱代码，复用未改变的已验证中文正文，并保留前后指纹。

续跑复用的 223 个内容块逐片段核对原始响应文件及指纹，分别记录实际模型上下文、请求参数和所属运行；组装时间不冒充响应生成时间。恢复 GAN 致谢后保留旧运行的 102 块分母，当前完整正文为 103 块。阅读抽查发现的五个正文／图注块另行补译；InstructGPT 中用于对照错误语法与标准英语的原句保留英文，说明标签译为中文。

所有机器翻译和转换仍标记 `humanReviewed: false`。来源覆盖、结构一致性、数字与公式检查，以及有限的页面阅读抽查，不等于全文经过人工逐句审校。

论文库增加“经典论文”筛选与对应模型系列，覆盖视觉、自然语言、生成模型和强化学习。新增十二篇共 2153 个对齐内容块、1068 个正文素材和 1105 个处理后文件（包含目录）。完整公开库为 67 篇、21663 个内容块、2719 个正文素材、2924 个处理后文件；原有 55 篇的 1819 个正文、元数据与素材文件指纹保持一致。

完整工作数据通过严格来源及翻译校验，十二篇导出和完整公开库均通过严格发布校验。TypeScript、135 项前端测试、211 项 Node 测试、8 项 PDF 矢量转换测试，以及默认无数据构建和完整论文库构建通过。

最终阅读器逐篇加载十二篇的中英文正文，检查内容块数量、图片和内部引用目标；素材检查中临时启用即时加载，另行抽查正常的延迟加载。1440×1000 桌面验证覆盖“经典论文”筛选（12／67）和双向段落同步；390×844 手机验证覆盖单栏阅读、DQN 全 49 款游戏的宽表格、AlphaGo 原始公式，以及 InstructGPT 九段字面代码。页面没有整体横向溢出，宽表格在内容块内滚动，控制台未出现错误或警告。

用户明确授权“全部做好中英文版本的网页以后，然后直接发布”；本轮按此范围发布上述十二篇和相关导入、校验与筛选改动，原始下载、模型权重、OCR 输入和模型响应不进入公开库。
