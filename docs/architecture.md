# 架构说明

## 总体架构

CubeAgent 按三层推进：

```text
AI Chat Client
  |
  |-- 普通聊天
  |-- 标准复盘入口
  |-- 局部追问
  |-- 播放链接展示
        |
        v
Lightweight Agent Runtime
  |
  |-- intent detector
  |-- tool router
  |-- solve memory
  |-- response composer
        |
        v
Cubing Domain Tools
  |
  |-- parseTimedMoves
  |-- parseSegmentedSolution
  |-- createSolveReview
  |-- analyzeCFOP
  |-- searchAlgorithms
  |-- buildPlaybackUrl
```

当前仓库先实现 `Cubing Domain Tools` 的最小 PoC。

## 关键边界

### AI Chat Client

负责用户体验、消息流、上下文面板和播放链接展示。后续推荐使用 React / Next.js 与轻量 chat streaming 方案。

### Lightweight Agent Runtime

负责判断用户意图、选择工具、保存当前 solve 上下文、组织回答。第一版轻量自研，不直接引入 LangGraph/Mastra 这类重型 agent 框架。

### Cubing Domain Tools

负责所有确定性事实：

- move 和时间戳解析。
- 分段解析。
- 指标计算。
- cube state tracing。
- CFOP 阶段分析。
- 公式检索。
- 播放链接生成。

LLM 只能使用这些工具输出的结构化结果，不直接凭文本猜测魔方状态。

## 技术决策

### 先自研魔方领域核心

魔方状态、阶段、公式、播放链接是项目核心价值，需要自研掌控。外部框架可以用于客户端和流式聊天，但不应决定领域模型。

### 先轻量 agent runtime

PoC 阶段需要的流程是：

```text
用户消息
  -> 判断是否包含 solve / scramble / 分段 / 公式问题
  -> 调用魔方工具
  -> 把结构化结果交给 LLM
  -> 输出教练式回答和播放链接
```

该流程用轻量 tool router 足够。等需要持久化工作流、人类介入、多 agent 分工或复杂 trace 时，再评估 LangGraph/Mastra。

### 播放链接作为一等工具

播放链接不是普通网页跳转，而是可被其他客户端嵌入渲染的动画载体。当前 PoC 先支持 `alg.cubing.net` 兼容格式，后续预留 Twizzle / TwistyPlayer adapter。

### 公式库采用本地只读快照

第一版可参考 CubingApp / SpeedCubeDB 等现成数据源，但运行时应使用本地 JSON 快照，避免依赖第三方在线接口稳定性。

## 当前模块

- `src/cubing-tools/parsers.js`：时间戳 moves 与分段文本解析。
- `src/cubing-tools/playback-url.js`：播放链接和 BBCode 生成。
- `src/cubing-tools/solve-review.js`：`SolveReview` 组装和基础指标计算。
- `src/cubing-tools/index.js`：工具导出入口。
- `scripts/poc.js`：内置样例验证脚本。
