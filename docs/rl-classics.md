# 强化学习经典论文扩充

用户明确确认“全部45篇，完成后直接发布”。本批固定为下列 45 篇；收录边界与完整作者身份保存在 [集合清单](../paper-metadata/collections/rl-classics-45.json)。公开正文采用独立英文 `en.html` 和中文 `zh.html`，原始来源、PDF、图像转换中间件、模型响应与续跑检查点保存在被 Git 忽略的工作目录。

## 固定来源与阅读范围

| 论文 | 作者 | 固定官方来源 | 阅读组 |
| --- | --- | --- | --- |
| Learning to predict by the methods of temporal differences | Richard S. Sutton | [Machine Learning 3:9–44 (1988), DOI 10.1007/BF00115009](https://link.springer.com/article/10.1007/BF00115009) | 基础与时间抽象 |
| Q-learning | Christopher J. C. H. Watkins、Peter Dayan | [Machine Learning 8:279–292 (1992), DOI 10.1007/BF00992698](https://link.springer.com/article/10.1007/BF00992698) | 基础与时间抽象 |
| Simple statistical gradient-following algorithms for connectionist reinforcement learning | Ronald J. Williams | [Machine Learning 8:229–256 (1992), DOI 10.1007/BF00992696](https://link.springer.com/article/10.1007/BF00992696) | 基础与时间抽象 |
| Dyna, an integrated architecture for learning, planning, and reacting | Richard S. Sutton | [SIGART Bulletin 2(4):160–163 (1991), DOI 10.1145/122344.122377](https://dl.acm.org/doi/10.1145/122344.122377) | 基础与时间抽象 |
| Policy Gradient Methods for Reinforcement Learning with Function Approximation | Richard S. Sutton、David A. McAllester、Satinder P. Singh、Yishay Mansour | [NeurIPS 12 / NIPS 1999 正式会议版](https://proceedings.neurips.cc/paper/1999/hash/464d828b85b0bed98e80ade0a5c43b0f-Abstract.html) | 基础与时间抽象 |
| Between MDPs and semi-MDPs: A framework for temporal abstraction in reinforcement learning | Richard S. Sutton、Doina Precup、Satinder Singh | [Artificial Intelligence 112(1–2):181–211 (1999), DOI 10.1016/S0004-3702(99)00052-1](https://www.sciencedirect.com/science/article/pii/S0004370299000521) | 基础与时间抽象 |
| Deep Reinforcement Learning with Double Q-learning | Hado van Hasselt、Arthur Guez、David Silver | [1509.06461v3](https://arxiv.org/abs/1509.06461v3) | 价值学习与分布式回报 |
| Dueling Network Architectures for Deep Reinforcement Learning | Ziyu Wang、Tom Schaul、Matteo Hessel、Hado van Hasselt、Marc Lanctot、Nando de Freitas | [1511.06581v3](https://arxiv.org/abs/1511.06581v3) | 价值学习与分布式回报 |
| Prioritized Experience Replay | Tom Schaul、John Quan、Ioannis Antonoglou、David Silver | [1511.05952v4](https://arxiv.org/abs/1511.05952v4) | 价值学习与分布式回报 |
| Rainbow: Combining Improvements in Deep Reinforcement Learning | Matteo Hessel、Joseph Modayil、Hado van Hasselt、Tom Schaul、Georg Ostrovski、Will Dabney、Dan Horgan、Bilal Piot、Mohammad Azar、David Silver | [1710.02298v1](https://arxiv.org/abs/1710.02298v1) | 价值学习与分布式回报 |
| A Distributional Perspective on Reinforcement Learning | Marc G. Bellemare、Will Dabney、Rémi Munos | [1707.06887v1](https://arxiv.org/abs/1707.06887v1) | 价值学习与分布式回报 |
| Distributional Reinforcement Learning with Quantile Regression | Will Dabney、Mark Rowland、Marc G. Bellemare、Rémi Munos | [1710.10044v1](https://arxiv.org/abs/1710.10044v1) | 价值学习与分布式回报 |
| Implicit Quantile Networks for Distributional Reinforcement Learning | Will Dabney、Georg Ostrovski、David Silver、Rémi Munos | [1806.06923v1](https://arxiv.org/abs/1806.06923v1) | 价值学习与分布式回报 |
| Deterministic Policy Gradient Algorithms | David Silver、Guy Lever、Nicolas Heess、Thomas Degris、Daan Wierstra、Martin Riedmiller | [ICML 2014 / PMLR 32(1):387–395 正式会议版](https://proceedings.mlr.press/v32/silver14.html) | 策略梯度与连续控制 |
| Trust Region Policy Optimization | John Schulman、Sergey Levine、Philipp Moritz、Michael I. Jordan、Pieter Abbeel | [1502.05477v5](https://arxiv.org/abs/1502.05477v5) | 策略梯度与连续控制 |
| High-Dimensional Continuous Control Using Generalized Advantage Estimation | John Schulman、Philipp Moritz、Sergey Levine、Michael Jordan、Pieter Abbeel | [1506.02438v6](https://arxiv.org/abs/1506.02438v6) | 策略梯度与连续控制 |
| Proximal Policy Optimization Algorithms | John Schulman、Filip Wolski、Prafulla Dhariwal、Alec Radford、Oleg Klimov | [1707.06347v2](https://arxiv.org/abs/1707.06347v2) | 策略梯度与连续控制 |
| Asynchronous Methods for Deep Reinforcement Learning | Volodymyr Mnih、Adrià Puigdomènech Badia、Mehdi Mirza、Alex Graves、Timothy P. Lillicrap、Tim Harley、David Silver、Koray Kavukcuoglu | [1602.01783v2](https://arxiv.org/abs/1602.01783v2) | 策略梯度与连续控制 |
| Continuous control with deep reinforcement learning | Timothy P. Lillicrap、Jonathan J. Hunt、Alexander Pritzel、Nicolas Heess、Tom Erez、Yuval Tassa、David Silver、Daan Wierstra | [1509.02971v6](https://arxiv.org/abs/1509.02971v6) | 策略梯度与连续控制 |
| Addressing Function Approximation Error in Actor-Critic Methods | Scott Fujimoto、Herke van Hoof、David Meger | [1802.09477v3](https://arxiv.org/abs/1802.09477v3) | 策略梯度与连续控制 |
| Soft Actor-Critic: Off-Policy Maximum Entropy Deep Reinforcement Learning with a Stochastic Actor | Tuomas Haarnoja、Aurick Zhou、Pieter Abbeel、Sergey Levine | [1801.01290v2](https://arxiv.org/abs/1801.01290v2) | 策略梯度与连续控制 |
| Mastering Chess and Shogi by Self-Play with a General Reinforcement Learning Algorithm | David Silver、Thomas Hubert、Julian Schrittwieser、Ioannis Antonoglou、Matthew Lai、Arthur Guez、Marc Lanctot、Laurent Sifre、Dharshan Kumaran、Thore Graepel、Timothy Lillicrap、Karen Simonyan、Demis Hassabis | [1712.01815v1](https://arxiv.org/abs/1712.01815v1) | 世界模型与规划 |
| Mastering Atari, Go, Chess and Shogi by Planning with a Learned Model | Julian Schrittwieser、Ioannis Antonoglou、Thomas Hubert、Karen Simonyan、Laurent Sifre、Simon Schmitt、Arthur Guez、Edward Lockhart、Demis Hassabis、Thore Graepel、Timothy Lillicrap、David Silver | [1911.08265v2](https://arxiv.org/abs/1911.08265v2) | 世界模型与规划 |
| World Models | David Ha、Jürgen Schmidhuber | [1803.10122v4](https://arxiv.org/abs/1803.10122v4) | 世界模型与规划 |
| Deep Reinforcement Learning in a Handful of Trials using Probabilistic Dynamics Models | Kurtland Chua、Roberto Calandra、Rowan McAllister、Sergey Levine | [1805.12114v2](https://arxiv.org/abs/1805.12114v2) | 世界模型与规划 |
| When to Trust Your Model: Model-Based Policy Optimization | Michael Janner、Justin Fu、Marvin Zhang、Sergey Levine | [1906.08253v3](https://arxiv.org/abs/1906.08253v3) | 世界模型与规划 |
| Dream to Control: Learning Behaviors by Latent Imagination | Danijar Hafner、Timothy Lillicrap、Jimmy Ba、Mohammad Norouzi | [1912.01603v3](https://arxiv.org/abs/1912.01603v3) | 世界模型与规划 |
| Mastering Atari with Discrete World Models | Danijar Hafner、Timothy Lillicrap、Mohammad Norouzi、Jimmy Ba | [2010.02193v4](https://arxiv.org/abs/2010.02193v4) | 世界模型与规划 |
| Mastering Diverse Domains through World Models | Danijar Hafner、Jurgis Pasukonis、Jimmy Ba、Timothy Lillicrap | [2301.04104v2](https://arxiv.org/abs/2301.04104v2) | 世界模型与规划 |
| Off-Policy Deep Reinforcement Learning without Exploration | Scott Fujimoto、David Meger、Doina Precup | [1812.02900v3](https://arxiv.org/abs/1812.02900v3) | 离线强化学习 |
| Conservative Q-Learning for Offline Reinforcement Learning | Aviral Kumar、Aurick Zhou、George Tucker、Sergey Levine | [2006.04779v3](https://arxiv.org/abs/2006.04779v3) | 离线强化学习 |
| Offline Reinforcement Learning with Implicit Q-Learning | Ilya Kostrikov、Ashvin Nair、Sergey Levine | [2110.06169v1](https://arxiv.org/abs/2110.06169v1) | 离线强化学习 |
| Decision Transformer: Reinforcement Learning via Sequence Modeling | Lili Chen、Kevin Lu、Aravind Rajeswaran、Kimin Lee、Aditya Grover、Michael Laskin、Pieter Abbeel、Aravind Srinivas、Igor Mordatch | [2106.01345v2](https://arxiv.org/abs/2106.01345v2) | 离线强化学习 |
| Curiosity-driven Exploration by Self-supervised Prediction | Deepak Pathak、Pulkit Agrawal、Alexei A. Efros、Trevor Darrell | [1705.05363v1](https://arxiv.org/abs/1705.05363v1) | 探索与稀疏奖励 |
| Exploration by Random Network Distillation | Yuri Burda、Harrison Edwards、Amos Storkey、Oleg Klimov | [1810.12894v1](https://arxiv.org/abs/1810.12894v1) | 探索与稀疏奖励 |
| Hindsight Experience Replay | Marcin Andrychowicz、Filip Wolski、Alex Ray、Jonas Schneider、Rachel Fong、Peter Welinder、Bob McGrew、Josh Tobin、Pieter Abbeel、Wojciech Zaremba | [1707.01495v3](https://arxiv.org/abs/1707.01495v3) | 探索与稀疏奖励 |
| The Option-Critic Architecture | Pierre-Luc Bacon、Jean Harb、Doina Precup | [1609.05140v2](https://arxiv.org/abs/1609.05140v2) | 层次强化学习 |
| Multi-Agent Actor-Critic for Mixed Cooperative-Competitive Environments | Ryan Lowe、Yi Wu、Aviv Tamar、Jean Harb、Pieter Abbeel、Igor Mordatch | [1706.02275v4](https://arxiv.org/abs/1706.02275v4) | 多智能体强化学习 |
| Value-Decomposition Networks For Cooperative Multi-Agent Learning | Peter Sunehag、Guy Lever、Audrunas Gruslys、Wojciech Marian Czarnecki、Vinicius Zambaldi、Max Jaderberg、Marc Lanctot、Nicolas Sonnerat、Joel Z. Leibo、Karl Tuyls、Thore Graepel | [1706.05296v1](https://arxiv.org/abs/1706.05296v1) | 多智能体强化学习 |
| QMIX: Monotonic Value Function Factorisation for Deep Multi-Agent Reinforcement Learning | Tabish Rashid、Mikayel Samvelyan、Christian Schroeder de Witt、Gregory Farquhar、Jakob Foerster、Shimon Whiteson | [1803.11485v2](https://arxiv.org/abs/1803.11485v2) | 多智能体强化学习 |
| Apprenticeship Learning via Inverse Reinforcement Learning | Pieter Abbeel、Andrew Y. Ng | [ICML 2004 作者公开正式会议版](https://ai.stanford.edu/~pabbeel/irl/) | 模仿学习、逆强化学习与偏好对齐 |
| Maximum Entropy Inverse Reinforcement Learning | Brian D. Ziebart、Andrew Maas、J. Andrew Bagnell、Anind K. Dey | [AAAI 2008 正式会议版，pp.1433–1438；保留作者勘误说明](https://cdn.aaai.org/AAAI/2008/AAAI08-227.pdf) | 模仿学习、逆强化学习与偏好对齐 |
| Generative Adversarial Imitation Learning | Jonathan Ho、Stefano Ermon | [1606.03476v1](https://arxiv.org/abs/1606.03476v1) | 模仿学习、逆强化学习与偏好对齐 |
| Deep reinforcement learning from human preferences | Paul Christiano、Jan Leike、Tom B. Brown、Miljan Martic、Shane Legg、Dario Amodei | [1706.03741v4](https://arxiv.org/abs/1706.03741v4) | 模仿学习、逆强化学习与偏好对齐 |
| Direct Preference Optimization: Your Language Model is Secretly a Reward Model | Rafael Rafailov、Archit Sharma、Eric Mitchell、Stefano Ermon、Christopher D. Manning、Chelsea Finn | [2305.18290v3](https://arxiv.org/abs/2305.18290v3) | 模仿学习、逆强化学习与偏好对齐 |

年份按所选版本记录。AlphaZero 固定为 2017 年 arXiv v1，不冒充 2018 年 Science 版本。DPO 是偏好优化方法，单独归入后训练与偏好对齐；AlphaZero 的标签是规划与树搜索，没有把已知游戏规则模型说成学习得到的世界模型。

## 完整正文与转换

34 篇使用对应固定版本的官方 arXiv HTML，11 篇按 PDF → 英文 HTML → 中文 HTML 导入。十一份 PDF 布局配方绑定原始 PDF SHA-256、转换脚本、工具版本与参数、来源页码、图表边界及公式素材；章节、算法、脚注、附录、参考文献和内部引用保留为语义 HTML。公开处理数据不包含原始 PDF，也不使用整页截图代替正文。

七篇有可靠文字层的 PDF 使用 `convert-pdf.py` 1.5.0：PPO、HER、Deterministic Policy Gradient、Options、TD learning、Apprenticeship Learning、Maximum Entropy IRL。保留原始数学字形，可靠转写用 MathML；无法安全重建的公式保留紧边界 PDF 矢量，Type3 字体无法映射时使用单个公式的原始高分辨率裁图。公式图不是可语义检索的 MathML，元数据如实区分。

Dyna 的四页扫描正文实际使用已安装的 Qwen3.6 35B A3B 视觉识别，再由真正的 GPT-6 Luna 低思考子任务对照原图修正。Policy Gradient Theorem、Q-learning、REINFORCE 的英文转写修订实际来自 GPT-6，随后由 GPT-6 Luna 做独立公式及原图复核；REINFORCE 后续复核另修订 90 个块的行内数学与断词，生成 268 个 MathML 元素；Q-learning 后续复核修订 78 个块，生成 145 个 MathML 元素。两篇均按实际复核链重导入，旧英文和响应保留供复查；不因早期工作目录名称含 luna 就冒称由 Luna 主修订。OCR 组装器记录原始 PDF、正文块、复核报告、配方与素材指纹。原生文字层字符覆盖只证明文字层被覆盖，扫描页面的正确性依赖单独的机器复核记录。

TD learning 采用作者官网明确标注 2014-07-09 的数字重排本，共 36 页，恢复 Figure 3 并包含作者披露的少量文字与排版变化；该副本身份写入来源版本，另保留最初发表扫描本和勘误供复查。Maximum Entropy IRL 保留 AAAI 2008 原版算法，作者后续指出的 off-by-one 修正作为独立来源说明，没有静默改写原论文。

官方 HTML 也逐项核查转换缺陷。AlphaZero 的 12 个棋盘、MuZero 的四个环境示例、BCQ 的两状态 MDP 图和 Option-Critic 的六幅图，按同一固定版本 PDF 的局部图形边界恢复；VDN 的 22 个表格勾选符号从原始 SVG 提取，保留所属单元格。修复配方绑定原始 HTML、源 PDF、裁图边界、工具及图像指纹；表格正文和图注仍是语义 HTML。GPT-6 Luna 对 23 个裁图做了定向原图复核，VDN 图标核对限于官方 HTML 的原始 SVG 及 DOM 位置，未声称完成 PDF 交叉核验。

TRPO 的算法恢复循环结构并保留原有 MathML；Option-Critic 参考文献清除失败的编译标签；DreamerV3 首页清除 LaTeX 排版定义，保留原锚点。所有改动仅修复来源转换，原始来源字节保留，改动块的中文重新生成或按精确英文片段回放校验。

## 翻译与校验方法

中文主译复用 LM Studio 已有 `qwen3.6-35b-a3b`，发布者 mlx-community、MLX 4bit、架构 qwen3_5_moe，35B/A3B。最终续跑上下文为 16,384，全局最多四个请求；temperature 0.1、top_p 0.9，初轮 max_tokens 7000、精确片段续跑 max_tokens 4096，基础 seed 42，纠错重试另记录实际 seed，reasoning_effort none、stream false。实际请求先合并语义文本中的排版空白，原文与来源指纹不变；对于原片段没有数字的记录，响应约束禁止生成额外数字，避免把邻接引用年份复制进正文。请求参数不等于运行时绝无 reasoning token；用量按 API 实际返回累计。没有下载新权重。

DOM 文本片段翻译时冻结公式、图像、代码、数值、引用目标与内容顺序；重用旧响应时核对精确英文片段、响应字节指纹和实际模型运行身份。跨运行组装保留每个单元对应的模型、上下文、采样参数和响应指纹，组装时间不冒充请求时间。数字与术语检查同时覆盖片段、整块及表格单元格，避免跨单元格把下一行“千足虫”错误解释为上一行得分的数量单位。

GPT-6 Luna（`gpt-6-luna`，`reasoning_effort: low`）另做逐篇语义复核。采用其实际生成的片段修订时，按英文文本节点的完整 DOM 路径定位中文，校验源片段指纹和数字，保留千问原始翻译元数据，记录修改前后中文指纹、涉及单元及修订草稿指纹。原始 API 响应仍对应修改前的千问译文，辅助修正单独归因；不虚构 Luna 的 API token 用量。

VDN 最后一个未完成块以 Luna 的逐单元译稿作为千问结构化输出的固定候选，保留实际候选约束、复核报告指纹与模型响应。PDF 中与完整出版署名完全相同的作者名单标注为姓名保留块，避免误判为缺少中文正文。

全部转换、主译与辅助机器复核仍保持 `humanReviewed: false`。严格数据校验和有限视觉检查不等于全文人工逐句审校。

## 验收记录

2026-10-16 本地生产构建验收：

- 45 篇均有独立中英文全文，共 8,542 个对齐内容块；34 篇基于官方 HTML，11 篇完成 PDF 正文转换，3,195 个引用素材指纹通过。
- 29,302 个源文本单元检查无未关闭问题；1,046 条与当前来源匹配的 Luna 建议全部闭合。一条因英文来源修复失效的旧建议不作为当前复核依据。
- 原始数据严格检查、45 篇公开导出检查及合并后的 112 篇整库检查通过；整库为 30,205 个内容块、5,914 个素材、6,256 个公开文件。原有论文及两份研究报告的文件指纹保持不变，论文目录追加本批条目。
- TypeScript 检查、155 个前端测试及 243 个 Node 测试通过；PDF 转换相关 15 个 Python 测试通过。完整论文库生产构建通过。
- 45 篇均在实际阅读器打开并核对双语块数，无待译标记、可见损坏图片或外层横向溢出。另检查分类入口、桌面双栏同步滚动、公式和表格、引用跳转、390×844 手机布局、语言切换、目录抽屉及暗色公式显示；临时手机视口已恢复为默认桌面尺寸。

发布结果以对应合并提交、生产部署及正式域名的文件指纹实测记录为准。以上均为机器校验，不代表全文人工审校。
