import { tool } from "ai";
import { z } from "zod";
import { buildPlaybackBBCode, createSolveReview, searchAlgorithms } from "../cubing-tools/index.js";

const createSolveReviewInputSchema = z.object({
  puzzle: z.string().optional().describe("默认使用 333。"),
  source: z.string().optional().describe("输入来源，例如 chat。"),
  scramble: z.string().describe("本次 solve 的 scramble。"),
  timedMoves: z.string().describe("带时间戳的转动序列，例如 U@0 R@120。"),
  segmentedSolution: z.string().optional().describe("可选的分段文本，每行形如 R U R' // F2L 1。")
});

const inspectSolveSegmentInputSchema = z.object({
  segmentId: z.string().optional().describe("分段 id，例如 f2l-1。"),
  segmentLabel: z.string().optional().describe("分段标签，例如 F2L 1、OLL、PLL。")
});

const searchAlgorithmsInputSchema = z.object({
  set: z.string().optional().describe("公式集，例如 OLL、PLL。"),
  caseId: z.string().optional().describe("case 编号，例如 27、T、Aa。"),
  tags: z.array(z.string()).optional().describe("过滤标签，例如 right-hand、no-rotation。"),
  limit: z.number().optional().describe("最多返回多少条推荐公式。")
});

const buildPlaybackLinkInputSchema = z.object({
  setup: z.string().optional().describe("setup 公式，可为空。"),
  alg: z.string().describe("要回放的公式。"),
  label: z.string().optional().describe("展示标签。")
});

const AGENT_TOOL_DEFINITIONS = [
  {
    name: "create_solve_review",
    description: "导入一次 3x3 solve，基于 scramble、timedMoves 和可选分段文本生成完整复盘结果。",
    inputSchema: createSolveReviewInputSchema,
    execute: executeCreateSolveReview
  },
  {
    name: "inspect_solve_segment",
    description: "读取当前 solve 中某个阶段分段的局部分析，用于回答 Cross / F2L / OLL / PLL 的追问。",
    inputSchema: inspectSolveSegmentInputSchema,
    execute: executeInspectSolveSegment
  },
  {
    name: "search_algorithms",
    description: "查询现有公式数据，适用于 OLL / PLL 公式推荐或用户直接查询公式。",
    inputSchema: searchAlgorithmsInputSchema,
    execute: executeSearchAlgorithms
  },
  {
    name: "build_playback_link",
    description: "为给定 setup 和公式生成可直接渲染的 playback 链接。",
    inputSchema: buildPlaybackLinkInputSchema,
    execute: executeBuildPlaybackLink
  }
];

export function getAgentToolSchemas() {
  return AGENT_TOOL_DEFINITIONS.map((definition) => ({
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: z.toJSONSchema(definition.inputSchema)
    }
  }));
}

export function createAiSdkAgentTools({ getContext, updateContext, onProgress } = {}) {
  return Object.fromEntries(
    AGENT_TOOL_DEFINITIONS.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (args) => {
          const execution = await executeAgentToolDefinitionSafely(definition, args, getContext?.() ?? {}, onProgress);
          updateContext?.(execution.contextPatch ?? {});
          return execution;
        },
        toModelOutput: ({ output }) => ({
          type: "json",
          value: output?.content ?? output
        })
      })
    ])
  );
}

export async function executeAgentToolCall({ name, args, context, onProgress }) {
  const definition = AGENT_TOOL_DEFINITIONS.find((item) => item.name === name);
  if (!definition) {
    throw new Error(`未知工具：${name}`);
  }
  return definition.execute(args, context, onProgress);
}

async function executeAgentToolDefinitionSafely(definition, args, context, onProgress) {
  try {
    return await definition.execute(args, context, onProgress);
  } catch (error) {
    return buildToolError(
      "TOOL_EXECUTION_FAILED",
      String(error?.message ?? error ?? `${definition.name} 执行失败。`)
    );
  }
}

async function executeCreateSolveReview(args = {}, context = {}, onProgress) {
  const params = {
    puzzle: args.puzzle || "333",
    source: args.source || "chat",
    scramble: args.scramble ?? "",
    timedMoves: args.timedMoves ?? "",
    segmentedSolution: args.segmentedSolution ?? ""
  };

  if (!params.scramble) {
    throw new Error("导入 solve 需要提供 scramble。");
  }

  const review = await createSolveReview({
    ...params,
    onProgress
  });
  return {
    toolResult: {
      type: "solve-review",
      review
    },
    content: compactSolveReview(review),
    contextPatch: {
      currentSolveReview: review,
      lastImportError: null,
      selectedSegmentId: null,
      lastIntent: "solve-import",
      previousContextKeys: Object.keys(context ?? {})
    }
  };
}

function executeInspectSolveSegment(args = {}, context = {}) {
  const review = context.currentSolveReview;
  if (!review) {
    return buildToolError("NO_SOLVE_CONTEXT", "当前没有已导入的 solve，无法读取分段。");
  }

  const segment = args.segmentId
    ? review.segments.find((item) => item.id === args.segmentId)
    : findSegment(review, args.segmentLabel);

  if (!segment) {
    return buildToolError("SEGMENT_NOT_FOUND", `未找到分段：${args.segmentLabel ?? args.segmentId ?? "未指定"}`);
  }

  const stage = review.cfopAnalysis.stages.find((item) => item.segmentId === segment.id);
  const suggestions = review.coachSuggestions.suggestions.filter((suggestion) => suggestion.target?.segmentId === segment.id);

  return {
    toolResult: {
      type: "segment-inspection",
      segment,
      stage,
      suggestions
    },
    content: compactSegmentInspection(segment, stage, suggestions),
    contextPatch: {
      selectedSegmentId: segment.id,
      lastIntent: "local-followup"
    }
  };
}

function executeSearchAlgorithms(args = {}) {
  const result = searchAlgorithms({
    set: args.set,
    caseId: args.caseId,
    tags: Array.isArray(args.tags) ? args.tags : [],
    limit: Number.isFinite(args.limit) ? args.limit : undefined
  });

  return {
    toolResult: {
      type: "algorithm-search",
      result
    },
    content: {
      type: "algorithm-search",
      query: result.query,
      total: result.total,
      results: result.results.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        caseId: candidate.caseId,
        alg: candidate.alg,
        metrics: candidate.metrics,
        playback: candidate.playback
      }))
    },
    contextPatch: {
      lastAlgorithmQuery: result.query
    }
  };
}

function executeBuildPlaybackLink(args = {}) {
  const alg = String(args.alg ?? "").trim();
  if (!alg) {
    throw new Error("生成 playback 链接时必须提供 alg。");
  }

  const playback = {
    bbcode: buildPlaybackBBCode({
      setup: args.setup ?? "",
      alg,
      label: args.label
    })
  };

  return {
    toolResult: {
      type: "playback-link",
      playback
    },
    content: {
      type: "playback-link",
      playback
    },
    contextPatch: {}
  };
}

function buildToolError(code, message) {
  return {
    toolResult: {
      type: "error",
      code,
      message
    },
    content: {
      type: "error",
      code,
      message
    },
    contextPatch: {}
  };
}

function compactSolveReview(review) {
  return {
    type: "solve-review",
    puzzle: review.puzzle,
    summary: review.summary,
    validation: review.validation,
    segmentation: review.segmentation,
    cfopAnalysis: review.cfopAnalysis,
    coachSuggestions: {
      total: review.coachSuggestions?.suggestions?.length ?? 0,
      suggestions: review.coachSuggestions?.suggestions?.slice(0, 6) ?? []
    },
    segments: review.segments.map((segment) => ({
      id: segment.id,
      label: segment.label,
      moveCount: segment.moveCount,
      effectiveMoveCount: segment.effectiveMoveCount,
      durationMs: segment.durationMs,
      tps: segment.tps,
      pauses: segment.pauses.length,
      recognition: segment.recognition
    })),
    playback: review.playback
  };
}

function compactSegmentInspection(segment, stage, suggestions) {
  return {
    type: "segment-inspection",
    segment: {
      id: segment.id,
      label: segment.label,
      moveCount: segment.moveCount,
      effectiveMoveCount: segment.effectiveMoveCount,
      durationMs: segment.durationMs,
      tps: segment.tps,
      pauses: segment.pauses.length,
      recognition: segment.recognition,
      playback: segment.playback
    },
    stage,
    suggestions
  };
}

function findSegment(review, label) {
  if (!label) {
    return null;
  }

  const normalizedLabel = String(label).toLowerCase().replace(/\s+/g, " ").trim();
  return review.segments.find((segment) => segment.label.toLowerCase().replace(/\s+/g, " ").trim() === normalizedLabel);
}
