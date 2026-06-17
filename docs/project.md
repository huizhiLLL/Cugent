# 项目状态

## 项目目标

Cugent 要做的是一个魔方智能教练 AI 客户端，而不是单次输入输出的分析工具。

核心体验是 AI Chat：用户可以正常聊天、粘贴 solve、追问某一步、要求换公式、要求生成转动动画链接。Agent 在对话过程中自主调用魔方领域工具，基于结构化证据给出教练式反馈。

## 当前重点

当前阶段已从领域工具 PoC 推进到轻量 AI Chat 客户端闭环，并进入第一轮前端与 agent runtime 打磨：

- `csTimer/DCTimer` 时间戳 move 解析。
- 分段解法文本解析。
- `SolveReview` 数据结构。
- 基础指标计算：步数、耗时、TPS、停顿。
- 基于 `cubing.js` 的 scramble + solution 状态追踪。
- 无分段输入的 `cf4op` 自动阶段推断与置信度输出。
- 可嵌入播放链接生成。
- 轻量 agent runtime：保留本地规则 fallback，并开始接入第一版基于 OpenAI 兼容 tools 的 agent loop。
- React / Vite Web 客户端：基于 assistant-ui 外部状态 runtime 与 shadcn 组件，保留单一 chat 工作区和本地转动预览。
- 空会话欢迎态：未开始对话时输入框居中显示，上方是一句简单问候；开始对话后输入框回到底部。
- 输入框 `+` 扩展面板：当前只保留“智能魔方”结构化导入入口；智能魔方弹窗填写打乱、带时间戳回顾、可选分段解法。
- 真实复制输入体验：常见字段别名识别、结构化导入错误展示。
- 纯客户端 LLM 最小闭环：前端填写 OpenAI 兼容接口后，可直接直连 `chat/completions`。
- 第一版 streaming：assistant 回复支持边生成边展示，取消时保留当前已生成内容。
- 流式回复性能优化：token 增量优先写入轻量 streaming state，结束后再合并回会话消息，避免侧边栏和历史列表随每个 token 重排。
- 会话状态持久化优化：浏览器本地存储改为延迟写入，并在关键时机主动 flush。
- 第一版 prompt 分层：`chat / solve-import / algorithm-query / local-followup` 使用不同回复策略。
- 第一版 LLM 错误分类与 fallback：配置缺失、鉴权、限流、超时、网络或 CORS 失败时自动退回本地摘要。
- 会话级状态：对话历史、本地上下文、当前会话切换与标题生成已持久化到浏览器本地存储。
- 会话管理：支持新建、重命名、删除和按最近更新时间排序。
- 消息操作：支持复制、编辑、删除和 assistant 回复重试。
- 前端结构：会话列表、桌面侧边栏和移动历史抽屉已从 `main.jsx` 抽成独立展示组件；运行时编排仍保留在顶层。
- 设置入口：桌面端移动到左侧边栏左下角设置图标；设置弹窗已改为左侧菜单、右侧内容区布局，当前包含“自定义 LLM”设置项。
- AI 结果分层呈现：assistant 正文显示 LLM 整理结果，结构化分析详情单独以“分析结果详情”工具态展示，并默认展开。
- 输出安全：LLM 回复中的播放链接会剥离非 `alg.cubing.net` 目标，避免错误或不可信动画链接进入渲染。
- 样式基线：复盘详情与播放预览已改用主题 token，未引用的旧 `.message-list`、`.composer`、`.smart-dialog` 等样式已清理。

下一阶段重点不再是“能否接模型”，而是继续补齐结构化语义路由、长会话上下文治理、工具调用态体验、中文文案一致性和前端运行时拆分。

## 已确定的产品方向

- 主产品形态是 AI Chat 客户端。
- 标准复盘只是客户端内的一个 workflow。
- LLM 不直接判断魔方事实，只读取确定性工具输出。
- 第一版只做 3x3 CFOP。
- 第一版必须支持带 scramble 的真实 solve 分析。
- 动画链接是核心能力，需支持类似 `[URL="..."]R'[/URL]` 的外部嵌入格式。

## 暂不做

- 用户账号、云同步、排行榜。
- 多 solve 长期记忆。
- 训练计划系统。
- 自动从 DCTimer 同步数据。
- 完整个人公式库管理。
- 高精度手法建模。
- 完整 MCP server 或通用 skill 产品。
- 非 3x3 或 Roux/ZZ/Petrus 分析。

## 当前验证方式

```bash
npm install
npm run dev
npm test
npm run build
npm run poc
npm run agent:poc
```
