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
  |-- traceCubeState
  |-- analyzeCFOP
  |-- searchAlgorithms
  |-- buildPlaybackUrl
```

当前仓库先实现 `Cubing Domain Tools` 和轻量 `Agent Runtime` 的最小 PoC。

## 关键边界

### AI Chat Client

负责用户体验、消息流、输入扩展和播放链接展示。当前 Web 客户端基于 React / Vite、assistant-ui 外部状态 runtime 与 shadcn 组件实现，先不接真实模型，只调用本地 `runAgentTurn`。

当前客户端布局：

- 左侧可折叠侧边栏：仅保留新建对话入口。
- 主 chat 工作区：assistant-ui `Thread` 承载消息流和输入框。空会话时显示居中的简单问候与输入框；首条消息发出后切换为常规消息流和底部输入框。输入框保持普通聊天形态，`+` 扩展打开添加内容面板，其中包含“智能魔方”结构化导入入口；开发调试快捷消息也收纳在该扩展面板中。
- solve 的总览指标、阶段目标、结构化建议和播放预览作为 assistant 回复的一部分展示，不再单独维护右侧分析面板。
- 移动端保留同一套单栏 chat 体验。

当前客户端的功能图标统一使用 `lucide-react`。品牌与站点图标只使用 `cubeagent-logo.png` 这类独立品牌资产，不混入功能按钮图标体系。通用功能图标的默认尺寸、描边和按钮容器由 `src/web/styles.css` 与 `TooltipIconButton` 统一控制，局部组件只在确有层级差异时覆盖尺寸。

后续接入真实模型时，可保留当前 `runAgentTurn` 作为工具路由和 fallback。

### Lightweight Agent Runtime

负责判断用户意图、选择工具、保存当前 solve 上下文、组织回答。第一版轻量自研，不直接引入 LangGraph/Mastra 这类重型 agent 框架。

当前 runtime 是规则原型，不包含 LLM：

- `solve-import`：识别 scramble、timedMoves、segmentedSolution，调用 `createSolveReview`。
- `algorithm-query`：识别 F2L/OLL/PLL 公式查询，调用 `searchAlgorithms`。
- `local-followup`：基于当前 `currentSolveReview` 返回指定分段的状态、阶段分析和建议。
- `chat`：未命中特定工具时交给普通聊天模型处理。

当前 solve 导入支持常见复制字段别名：

- `scramble` / `打乱`
- `timedMoves` / `timed moves` / `moves` / `review` / `复盘`
- `segmentedSolution` / `segmented solution` / `segments` / `solution` / `分段`

导入失败会返回结构化错误码和细节，例如非法 timed move、timestamp 倒退、分段行缺少 label。Web 客户端会在 chat 回复中展示这些错误细节。

每个 turn 会返回：

- `intent`：识别结果。
- `toolCalls`：本轮调用的工具及参数摘要。
- `toolResult`：结构化工具输出。
- `contextPatch`：需要合并到会话上下文的状态。
- `response`：由 `response-composer` 生成的中文 fallback 摘要。

### Cubing Domain Tools

负责所有确定性事实：

- move 和时间戳解析。
- 分段解析。
- 指标计算。
- cube state tracing。
- 分段前后状态快照。
- 分段与时间戳序列的对齐校验。
- CFOP 阶段分析。
- 公式检索。
- 结构化教练建议。
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

播放链接不是普通网页跳转，而是可被其他客户端嵌入渲染的动画载体。当前 PoC 支持 `alg.cubing.net` 兼容格式，并在 Web 客户端中用 `cubing.js` 的 `twisty-player` 渲染本地转动动画。后续仍预留 Twizzle adapter。

### 公式库采用本地只读快照

第一版已在 `data/algorithms/` 下放入小型手写 F2L / OLL / PLL JSON 快照，用于验证检索协议。后续可参考 CubingApp / SpeedCubeDB 等现成数据源扩展数据，但运行时仍应使用本地 JSON 快照，避免依赖第三方在线接口稳定性。

`searchAlgorithms` 当前支持：

- 按 `set` 检索：F2L / OLL / PLL。
- 按 `caseId` 检索。
- 按 `tags` 过滤，例如 right-hand、no-rotation、beginner-friendly。
- 返回候选公式、基础 metrics 和可嵌入播放 BBCode。

### CFOP 分析先做阶段目标验证

当前 `analyzeCFOP` 只判断阶段目标是否达成：

- Cross：D 面 4 条棱是否回到 solved 状态。
- F2L：D 层 4 个角和中层 4 条棱是否回到 solved 状态。
- OLL：U 层角/棱朝向是否完成。
- PLL：整 cube 是否 solved。

它暂不做 F2L case 识别、OLL/PLL case 命名或公式推荐。

### 教练建议是结构化证据，不是最终话术

`coachSuggestions` 会综合输入校验、阶段目标、停顿、TPS 和公式候选，生成建议对象。每条建议包含 type、priority、target、evidence、action，供 Agent/LLM 在 chat 中组织成自然语言回答。

当前建议类型：

- `input-validation`：输入对齐或数据质量问题。
- `stage-goal`：阶段目标未完成。
- `pause`：阶段中存在明显停顿。
- `tempo`：阶段 TPS 偏低。
- `algorithm-candidates`：从本地公式库命中的候选公式。

### Response composer 是本地 fallback

`response-composer` 负责把 `toolResult` 转为稳定中文摘要，便于命令行 PoC 和未来前端直接展示。它不替代最终 LLM 回复；接入 LLM 后，可以把 `toolResult` 和 `response` 一起作为模型组织回答的上下文。

## 当前模块

- `src/cubing-tools/parsers.js`：时间戳 moves 与分段文本解析。
- `src/cubing-tools/playback-url.js`：播放链接和 BBCode 生成。
- `src/cubing-tools/state-tracer.js`：基于 `cubing.js` 的 3x3 状态追踪。
- `src/cubing-tools/cfop-analyzer.js`：CFOP 阶段目标验证。
- `src/cubing-tools/algorithm-search.js`：本地公式库检索。
- `src/cubing-tools/coach-suggestions.js`：结构化教练建议生成。
- `src/cubing-tools/solve-review.js`：`SolveReview` 组装、基础指标计算、分段状态快照与输入校验。
- `data/algorithms/*.json`：本地公式库快照。
- `src/cubing-tools/index.js`：工具导出入口。
- `src/agent-runtime/intent-detector.js`：轻量意图识别。
- `src/agent-runtime/agent-runtime.js`：工具路由与上下文 patch。
- `src/agent-runtime/response-composer.js`：结构化结果到中文 fallback 回复。
- `src/web/main.jsx`：最小 Web 客户端入口。
- `src/web/styles.css`：Web 客户端样式。
- `scripts/agent-poc.js`：agent runtime 演示脚本。
- `scripts/poc.js`：内置样例验证脚本。
