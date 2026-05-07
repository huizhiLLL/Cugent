<h4 align="right">简体中文</h4>

<div align="center">
  <img src=".github/assets/cubeagent-logo.png" alt="CubeAgent logo" width="128" height="128" />

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
- 校验分段文本与时间戳 moves 是否对齐。
- 输出第一版 `cfopAnalysis`：Cross/F2L/OLL/PLL 阶段目标验证。
- 提供小型本地 F2L/OLL/PLL 公式快照和 `searchAlgorithms` 检索工具。
- 生成 `coachSuggestions` 结构化建议，作为后续 Agent/LLM 的证据输入。
- 提供轻量 `agent-runtime` 原型，支持 solve 导入、公式查询和局部追问。
- 提供 `response-composer`，把结构化工具结果转成稳定中文 fallback 回复。
- 提供最小 Web 客户端：左侧 chat，右侧 solve context 面板。
- 生成兼容 `alg.cubing.net` 的可嵌入播放链接，并用 `cubing.js` 的 `twisty-player` 在页面内渲染转动动画。

## 快速验证

```bash
npm install
npm run dev
npm test
npm run poc
npm run agent:poc
```

`npm run dev` 会启动本地 Web 客户端，默认地址是 `http://127.0.0.1:5173`。
`npm run poc` 会运行内置样例，输出结构化复盘摘要和播放链接。
`npm run agent:poc` 会演示轻量 agent runtime 的三条路径：solve 导入、公式查询、局部追问。

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
