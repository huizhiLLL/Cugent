# Roadmap

## Phase 0：领域工具 PoC

- 建立项目文档与架构边界。
- 实现时间戳 moves parser。
- 实现分段复盘 parser。
- 实现 `SolveReview` 结构与基础指标。
- 实现可嵌入播放链接生成。
- 使用内置样例完成命令行验证。
- 引入 `cubing.js` 并验证 scramble + solution 状态追踪。

## Phase 1：真实 cube state 与 CFOP 分析

- 扩展 cube state trace 到阶段级前后状态。已完成基础快照。
- 校验分段文本与时间戳 moves 是否对齐。已完成基础 warning。
- 校验阶段前后状态。已完成第一版 CFOP 目标验证。
- 支持无分段时的 `cf4op` 阶段推断，并标记置信度。已完成第一版。
- 对非法 move、timestamp 异常输出结构化错误。

## Phase 2：公式库与建议

- 导入 F2L / OLL / PLL 本地 JSON 快照。已完成小型手写样例。
- 实现公式检索和候选排序。已完成第一版 `searchAlgorithms`。
- 初步支持用户偏好：右手流、少转体、少 S/M、保留熟悉公式。已完成基于 tags 的基础过滤。
- 每条建议必须附带证据：阶段、耗时、停顿、步数、候选公式差异。已完成第一版 `coachSuggestions`。

## Phase 3：AI Chat 客户端

- 实现轻量 agent runtime 原型。已完成 solve 导入、公式查询、局部追问三条路径。
- 实现本地 response composer。已完成结构化结果到中文 fallback 回复。
- 建立 React / Vite 最小客户端。已完成单一 chat 工作区，并已演进到真实会话历史与本地持久化。
- 接入 assistant-ui 与 shadcn 客户端基座。已完成外部状态 runtime 对接、shadcn 输入/弹窗组件接入。
- 优化空会话欢迎态。已实现居中问候与居中输入框，开始对话后切换为常规底部输入。
- 优化真实复制输入体验。已支持常见字段别名和导入错误结构化展示。
- 增加输入框 `+` 扩展面板。已收纳“智能魔方”结构化导入和开发调试快捷消息，其中智能魔方支持打乱、带时间戳回顾、可选分段解法三个结构化字段。
- 接入 chat streaming。已完成第一版前端 SSE 流式接入与取消。
- 支持在 chat 中粘贴 solve 并自动调用工具。已完成。
- 支持用户继续追问局部阶段、单步、单公式。已完成基础路径。
- 支持前端配置 OpenAI 兼容接口。已完成“自定义 LLM”设置项。
- 引入 AI SDK / assistant-ui 生态规范 agent loop 和工具协议。已完成第一步：tool registry 使用 Zod schema + AI SDK tools，LLM tool loop 改为 `streamText + stopWhen`，provider 兼容集中到 `llm-provider.js`。
- 扩展 provider profile/capabilities。已完成第一版：前端设置支持 DeepSeek 和自定义 OpenAI 兼容接口，并保存 provider capabilities 供 runtime 使用；DeepSeek 隐藏 API 地址和模型名输入。
- 统一普通 LLM 润色调用。已完成：`enhanceAgentTurnResponse` 从手写 `/chat/completions` 和 SSE 解析迁到 AI SDK，并根据 `streaming / usage` capabilities 降级。
- 支持消息级复制、编辑、删除、重试。已完成第一版。
- 支持会话级新建、重命名、删除、排序。已完成第一版。
- 支持将分析详情从正文中拆分为工具态展示。已完成第一版。

## Phase 3.5：AI 体验打磨

- 细化语义路由，升级为 `intent + subIntent`。
- 建立长会话上下文治理：裁剪、摘要、solve 上下文优先级。
- 强化 LLM 输出约束，提升“引用工具证据”的稳定性。
- 完整化工具调用态：参数摘要、结果状态、可能的多工具顺序展示。
- 基于 provider profile/capabilities 继续扩展按模型能力切换工具策略；不做多 provider 凭据管理或自动切换备用 provider。

## Phase 4：播放与可视化

- 抽象 visualizer adapter。
- 保留 `alg.cubing.net` 兼容链接。
- 增加 Twizzle / TwistyPlayer adapter。
- 支持外部嵌入 BBCode 输出。
- 支持本地预览。

## Phase 5：扩展能力

- DCTimer 复制输入适配优化。
- 多 solve 会话级历史。
- 用户公式库。
- 训练计划与长期趋势。
- MCP adapter 或 skill 暴露。
