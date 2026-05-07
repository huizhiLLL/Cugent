# Roadmap

## Phase 0：领域工具 PoC

- 建立项目文档与架构边界。
- 实现时间戳 moves parser。
- 实现分段复盘 parser。
- 实现 `SolveReview` 结构与基础指标。
- 实现可嵌入播放链接生成。
- 使用内置样例完成命令行验证。

## Phase 1：真实 cube state 与 CFOP 分析

- 引入 `cubing.js`。
- 用 scramble + solution 追踪 cube state。
- 校验阶段前后状态。
- 支持无分段时的 CFOP 阶段推断，并标记置信度。
- 对非法 move、timestamp 异常输出结构化错误。

## Phase 2：公式库与建议

- 导入 F2L / OLL / PLL 本地 JSON 快照。
- 实现公式检索和候选排序。
- 初步支持用户偏好：右手流、少转体、少 S/M、保留熟悉公式。
- 每条建议必须附带证据：阶段、耗时、停顿、步数、候选公式差异。

## Phase 3：AI Chat 客户端

- 建立 React / Next.js 客户端。
- 接入 chat streaming。
- 实现 solve context panel。
- 支持在 chat 中粘贴 solve 并自动调用工具。
- 支持用户继续追问局部阶段、单步、单公式。

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
