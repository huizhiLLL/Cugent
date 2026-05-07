# CubeAgent

CubeAgent 是一个面向 3x3 CFOP 复盘的魔方 AI 教练客户端 PoC。

项目目标不是做一次性报告生成器，而是做一个以 AI Chat 为主容器的客户端：用户可以粘贴 scramble、带时间戳的解法序列和分段复盘文本，Agent 通过确定性魔方工具理解 solve 上下文，再在聊天中持续回答、追问、推荐公式和生成可嵌入的转动动画链接。

## 当前状态

当前阶段先落地领域工具 PoC，不引入完整前端和 AI SDK：

- 解析 `csTimer/DCTimer` 风格的 `U'@0 R@125 ...` 时间戳 moves。
- 解析 `// Cross`、`// F2L 1`、`// OLL`、`// PLL` 分段解法文本。
- 组装 `SolveReview` 结构，计算 move count、耗时、TPS 和停顿。
- 生成兼容 `alg.cubing.net` 的可嵌入播放链接。

## 快速验证

```bash
npm test
npm run poc
```

`npm run poc` 会运行内置样例，输出结构化复盘摘要和播放链接。

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
  |-- analyzeCFOP
  |-- searchAlgorithms
  |-- buildPlaybackUrl
```

## 边界

第一版只支持 3x3 CFOP 复盘。MCP、skill、账号系统、长期记忆、训练计划、DCTimer 自动同步和完整个人公式库都不在当前 PoC 范围内。
