import { buildPlaybackBBCode, createSolveReview, searchAlgorithms } from "../cubing-tools/index.js";

const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "create_solve_review",
      description: "导入一次 3x3 solve，基于 scramble、timedMoves 和可选分段文本生成完整复盘结果。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          puzzle: { type: "string", description: "默认使用 333。" },
          source: { type: "string", description: "输入来源，例如 chat。" },
          scramble: { type: "string", description: "本次 solve 的 scramble。" },
          timedMoves: { type: "string", description: "带时间戳的转动序列，例如 U@0 R@120。" },
          segmentedSolution: { type: "string", description: "可选的分段文本，每行形如 R U R' // F2L 1。" }
        },
        required: ["scramble", "timedMoves"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "inspect_solve_segment",
      description: "读取当前 solve 中某个阶段分段的局部分析，用于回答 Cross / F2L / OLL / PLL 的追问。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          segmentId: { type: "string", description: "分段 id，例如 f2l-1。" },
          segmentLabel: { type: "string", description: "分段标签，例如 F2L 1、OLL、PLL。" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_algorithms",
      description: "查询现有公式数据，适用于 OLL / PLL 公式推荐或用户直接查询公式。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          set: { type: "string", description: "公式集，例如 OLL、PLL。" },
          caseId: { type: "string", description: "case 编号，例如 27、T、Aa。" },
          tags: {
            type: "array",
            description: "过滤标签，例如 right-hand、no-rotation。",
            items: { type: "string" }
          },
          limit: { type: "number", description: "最多返回多少条推荐公式。" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "build_playback_link",
      description: "为给定 setup 和公式生成可直接渲染的 playback 链接。",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          setup: { type: "string", description: "setup 公式，可为空。" },
          alg: { type: "string", description: "要回放的公式。" },
          label: { type: "string", description: "展示标签。" }
        },
        required: ["alg"]
      }
    }
  }
];

export function getAgentToolSchemas() {
  return TOOL_SCHEMAS;
}

export async function executeAgentToolCall({ name, args, context, onProgress }) {
  switch (name) {
    case "create_solve_review":
      return executeCreateSolveReview(args, context, onProgress);
    case "inspect_solve_segment":
      return executeInspectSolveSegment(args, context);
    case "search_algorithms":
      return executeSearchAlgorithms(args);
    case "build_playback_link":
      return executeBuildPlaybackLink(args);
    default:
      throw new Error(`未知工具：${name}`);
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
    return {
      toolResult: {
        type: "error",
        code: "NO_SOLVE_CONTEXT",
        message: "当前没有已导入的 solve，无法读取分段。"
      },
      content: {
        type: "error",
        code: "NO_SOLVE_CONTEXT",
        message: "当前没有已导入的 solve，无法读取分段。"
      },
      contextPatch: {}
    };
  }

  const segment = args.segmentId
    ? review.segments.find((item) => item.id === args.segmentId)
    : findSegment(review, args.segmentLabel);

  if (!segment) {
    return {
      toolResult: {
        type: "error",
        code: "SEGMENT_NOT_FOUND",
        message: `未找到分段：${args.segmentLabel ?? args.segmentId ?? "未指定"}`
      },
      content: {
        type: "error",
        code: "SEGMENT_NOT_FOUND",
        message: `未找到分段：${args.segmentLabel ?? args.segmentId ?? "未指定"}`
      },
      contextPatch: {}
    };
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

  return {
    toolResult: {
      type: "playback-link",
      playback: {
        bbcode: buildPlaybackBBCode({
          setup: args.setup ?? "",
          alg,
          label: args.label
        })
      }
    },
    content: {
      type: "playback-link",
      playback: {
        bbcode: buildPlaybackBBCode({
          setup: args.setup ?? "",
          alg,
          label: args.label
        })
      }
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
