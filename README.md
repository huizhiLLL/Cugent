<h4 align="right">简体中文</h4>

<div align="center">
  <img src=".github/assets/cubeagent-logo.svg" alt="CubeAgent logo" width="128" height="128" />

  <h1>CubeAgent</h1>

  <p>
    面向 3x3 CFOP 复盘的魔方 AI 教练客户端 PoC。
  </p>

  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=20232A" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
    <img alt="cubing.js" src="https://img.shields.io/badge/cubing.js-0.63-2EC4B6?style=for-the-badge" />
  </p>
</div>

项目目标不是做一次性报告生成器，而是做一个以 AI Chat 为主容器的客户端：用户可以粘贴 scramble、带时间戳的解法序列和分段复盘文本，Agent 通过确定性魔方工具理解 solve 上下文，再在聊天中持续回答、追问、推荐公式和生成可嵌入的转动动画链接。

## 当前状态

当前阶段先落地领域工具 PoC，不引入完整前端和 AI SDK：

- 解析 `csTimer/DCTimer` 风格的 `U'@0 R@125 ...` 时间戳 moves。
- 解析 `// Cross`、`// F2L 1`、`// OLL`、`// PLL` 分段解法文本。
- 组装 `SolveReview` 结构，计算 move count、耗时、TPS 和停顿。
- 使用 `cubing.js` 追踪 scramble + solution 的 3x3 状态。
- 为每个分段记录进入前和结束后的 cube state。
- 在缺少 `segmentedSolution` 时，基于时间线状态自动推断第一版 `cf4op` 阶段。
- 校验分段文本与时间戳 moves 是否对齐。
- 输出第一版 `cfopAnalysis`：Cross/F2L/OLL/PLL 阶段目标验证。
- 提供小型本地 F2L/OLL/PLL 公式快照和 `searchAlgorithms` 检索工具。
- 生成 `coachSuggestions` 结构化建议，作为后续 Agent/LLM 的证据输入。
- 提供轻量 `agent-runtime` 原型，支持 solve 导入、公式查询和局部追问。
- 提供 `response-composer`，把结构化工具结果转成稳定中文 fallback 回复。
- 提供最小 LLM 接入闭环：本地 runtime 先完成意图判断与确定性工具调用，再把工具结果交给真实 LLM 组织成更自然的中文回复；若未配置 API Key 或模型失败，会自动退回本地 fallback 回复。
- 提供最小 Web 客户端：真实会话历史、本地持久化、消息编辑/删除/重试、设置面板与结构化分析工具态展示。
- 生成兼容 `alg.cubing.net` 的可嵌入播放链接，并用 `cubing.js` 的 `twisty-player` 在页面内渲染转动动画。

## 快速验证

```bash
npm install
npm run dev
npm test
npm run poc
npm run agent:poc
```

前端可在“LLM 设置”里填写：

```bash
接口基地址: https://api.huizhi.ink/v1
API Key: sk-...
模型名: gpt-5.4-mini
```

前端请求时会自动补成：

```text
https://api.huizhi.ink/v1/chat/completions
```

当前最小闭环策略是：

- `solve-import`、`algorithm-query`、`local-followup` 先走本地确定性工具。
- `chat` 直接交给真实 LLM。
- 非错误型工具结果也会把 `toolResult`、`response-composer` 的 fallback 回复和当前 context 一起发给 LLM，让模型只负责自然语言组织，而不负责判断魔方事实。
- 当前前端已支持基于 OpenAI 兼容 `chat/completions` 的 streaming。
- prompt 已按 `chat / solve-import / algorithm-query / local-followup` 做第一版分层。
- assistant 回复已拆成两层：正文展示 LLM 整理结果，分析详情单独以“分析结果详情”工具态展示。
- 前端会区分配置缺失、鉴权失败、限流、超时、网络或 CORS 等常见 LLM 错误，并在失败时回退到本地 fallback 回复。
- 若兼容接口不可用、未配置 API Key、CORS 不允许或模型调用失败，则继续展示本地 fallback 回复。

`npm run dev` 会启动本地 Web 客户端，默认地址是 `http://127.0.0.1:5173`。
`npm run poc` 会运行内置样例，输出结构化复盘摘要和播放链接。
`npm run agent:poc` 会演示轻量 agent runtime 的三条路径：solve 导入、公式查询、局部追问。

`segmentedSolution` 现在是可选字段；当只提供 `scramble + timedMoves` 时，工具会自动尝试推断 `Cross / F2L 1..4 / OLL / PLL` 阶段，并给出置信度。

## 计划中的客户端形态

```text
React / Next.js AI Chat Client
  |
  |-- Chat UI / streaming
  |-- Solve context panel
  |-- Playback link preview
  |
Lightweight Agent Runtime
  |
  |-- intent detector
  |-- tool router
  |-- solve memory
  |-- response composer
  |
Cubing Domain Tools
  |
  |-- parseTimedMoves
  |-- parseSegmentedSolution
  |-- createSolveReview
  |-- traceCubeState
  |-- analyzeCFOP
  |-- searchAlgorithms
  |-- buildPlaybackUrl
```

## 边界

第一版只支持 3x3 CFOP 复盘。MCP、skill、账号系统、长期记忆、训练计划、DCTimer 自动同步和完整个人公式库都不在当前 PoC 范围内。
