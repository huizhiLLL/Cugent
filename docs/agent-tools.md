# Agent Tools

本文档记录 Cugent agent runtime 的工具协议。工具定义以 `src/agent-runtime/tool-registry.js` 为准，统一使用 Zod schema 声明输入，并通过 AI SDK `tool()` 暴露给 LLM agent loop。

## 调用边界

- 前端不直接调用具体工具，只提交用户消息、当前会话上下文和 LLM 设置。
- `runAgentTurn` 负责判断是否进入 LLM agent loop；不能进入时走本地规则 fallback。
- LLM agent loop 只能通过 registry 中的工具获取魔方事实，不允许自行编造阶段、case、公式、TPS、停顿或播放链接。
- 工具执行结果会返回 `toolResult`、面向模型的压缩 `content`，以及需要写回会话的 `contextPatch`。

## 返回结构

每个工具执行成功或失败后都返回：

```js
{
  toolResult: object,
  content: object,
  contextPatch: object
}
```

- `toolResult`：runtime 内部使用的结构化结果，可供 fallback composer 和最终 turn 使用。
- `content`：传给模型的压缩结果，避免把过大的 solve 对象完整塞进 prompt。
- `contextPatch`：需要合并进会话上下文的增量，例如 `currentSolveReview`、`selectedSegmentId`。

工具错误统一返回：

```js
{
  toolResult: {
    type: "error",
    code: "ERROR_CODE",
    message: "面向用户或开发者可读的错误"
  },
  content: {
    type: "error",
    code: "ERROR_CODE",
    message: "面向模型可读的错误"
  },
  contextPatch: {}
}
```

## 工具列表

### `create_solve_review`

用途：导入一次 3x3 solve，基于 scramble、timedMoves 和可选分段文本生成完整复盘。

输入：

```js
{
  puzzle?: string,
  source?: string,
  scramble: string,
  timedMoves: string,
  segmentedSolution?: string
}
```

输出：

- `toolResult.type`: `solve-review`
- `toolResult.review`: 完整 solve review
- `content`: 压缩后的 summary、validation、segmentation、CFOP 分析、最多 6 条建议、分段摘要和 playback
- `contextPatch.currentSolveReview`: 完整 review
- `contextPatch.selectedSegmentId`: `null`
- `contextPatch.lastIntent`: `solve-import`

### `inspect_solve_segment`

用途：读取当前 solve 中某个阶段的局部分析，用于回答 Cross / F2L / OLL / PLL 的追问。

输入：

```js
{
  segmentId?: string,
  segmentLabel?: string
}
```

输出：

- `toolResult.type`: `segment-inspection`
- `toolResult.segment`: 完整分段对象
- `toolResult.stage`: 对应 CFOP 阶段分析
- `toolResult.suggestions`: 命中该分段的建议
- `content`: 压缩后的分段指标、阶段分析和建议
- `contextPatch.selectedSegmentId`: 当前分段 id
- `contextPatch.lastIntent`: `local-followup`

常见错误：

- `NO_SOLVE_CONTEXT`：当前没有已导入 solve
- `SEGMENT_NOT_FOUND`：找不到指定分段

### `search_algorithms`

用途：查询现有公式数据，适用于 OLL / PLL 公式推荐或用户直接查询公式。

输入：

```js
{
  set?: string,
  caseId?: string,
  tags?: string[],
  limit?: number
}
```

输出：

- `toolResult.type`: `algorithm-search`
- `toolResult.result`: 完整搜索结果
- `content.results`: 推荐公式摘要，包含 id、名称、case、公式、指标和 playback
- `contextPatch.lastAlgorithmQuery`: 实际查询条件

### `build_playback_link`

用途：为给定 setup 和公式生成可直接渲染的 playback 链接。

输入：

```js
{
  setup?: string,
  alg: string,
  label?: string
}
```

输出：

- `toolResult.type`: `playback-link`
- `toolResult.playback.bbcode`: alg.cubing.net BBCode
- `content.playback`: 同步给模型的播放链接数据

常见错误：

- `TOOL_EXECUTION_FAILED`：缺少 `alg` 或底层生成失败

## 版本与维护

- 工具名、输入字段和主要输出字段视为 agent contract 的一部分，修改时需要同步更新本文档和相关测试。
- 新增工具时优先补 Zod schema、压缩 `content`、上下文写回策略和一条契约测试。
- 面向用户的回复不直接展示工具协议字段；这些字段只服务 runtime、测试和开发态排查。
