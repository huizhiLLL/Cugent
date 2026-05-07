# 项目状态

## 项目目标

CubeAgent 要做的是一个魔方智能教练 AI 客户端，而不是单次输入输出的分析工具。

核心体验是 AI Chat：用户可以正常聊天、粘贴 solve、追问某一步、要求换公式、要求生成转动动画链接。Agent 在对话过程中自主调用魔方领域工具，基于结构化证据给出教练式反馈。

## 当前重点

当前阶段已从领域工具 PoC 推进到轻量 AI Chat 客户端闭环：

- `csTimer/DCTimer` 时间戳 move 解析。
- 分段解法文本解析。
- `SolveReview` 数据结构。
- 基础指标计算：步数、耗时、TPS、停顿。
- 基于 `cubing.js` 的 scramble + solution 状态追踪。
- 可嵌入播放链接生成。
- 轻量 agent runtime：solve 导入、公式查询、局部追问。
- React / Vite Web 客户端：基于 assistant-ui 外部状态 runtime 与 shadcn 组件，保留单一 chat 工作区和本地转动预览。
- 输入框 `+` 扩展面板：收纳“智能魔方”结构化导入入口和开发调试快捷消息；智能魔方弹窗填写打乱、带时间戳回顾、可选分段解法。
- 真实复制输入体验：常见字段别名识别、结构化导入错误展示。

后续接入真实 LLM 或 streaming 前，仍优先保证工具输出、导入错误和上下文联动稳定可控。

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
npm run poc
```
