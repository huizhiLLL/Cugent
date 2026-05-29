import { createSolveReview, searchAlgorithms } from "../cubing-tools/index.js";
import { detectIntent } from "./intent-detector.js";
import { runLlmAgentLoop } from "./llm-agent-loop.js";
import { enhanceAgentTurnResponse } from "./llm-client.js";
import { buildChatLlmFallbackText, getUserFacingLlmError } from "./llm-error-presenter.js";
import { composeResponse } from "./response-composer.js";

const BARE_PLL_CASE_PATTERN = /\b(Aa|Ab|Ua|Ub|Z|H|T|F|E|N|V|Y|Na|Nb|Ga|Gb|Gc|Gd|Ja|Jb|Ra|Rb)\b/i;

export async function runAgentTurn(message, context = {}, options = {}) {
  if (shouldUseLlmAgentLoop(message, context, options)) {
    try {
      const loopTurn = await runLlmAgentLoop({
        message,
        context,
        options: {
          ...options,
          onAgentEvent: options.onAgentEvent
        }
      });
      return withPreparedResponse(loopTurn);
    } catch (error) {
      // 如果 agent loop 失败，继续退回当前本地规则链路。
    }
  }

  let intent = detectIntent(message);
  let turn;

  if (intent.type === "chat" && shouldInspectSelectedSegment(message, context)) {
    intent = {
      type: "local-followup",
      confidence: 0.64,
      params: {
        selectedSegmentId: context.selectedSegmentId
      }
    };
  }

  if (intent.type === "solve-import") {
    turn = await runSolveImport(intent, context);
    return withResponse(turn, { message, context, options });
  }

  if (intent.type === "algorithm-query") {
    turn = runAlgorithmQuery(intent, context);
    return withResponse(turn, { message, context, options });
  }

  if (intent.type === "local-followup") {
    turn = runLocalFollowup(intent, context);
    return withResponse(turn, { message, context, options });
  }

  turn = {
    intent,
    toolCalls: [],
    toolResult: {
      type: "chat",
      needsModelResponse: true,
      message: "未命中特定魔方工具，交给普通聊天模型处理。"
    },
    contextPatch: {}
  };
  return withResponse(turn, { message, context, options });
}

function withPreparedResponse(turn) {
  const fallbackResponse = composeResponse(turn);
  return {
    ...turn,
    fallbackResponse,
    response: {
      ...fallbackResponse,
      text: turn.llmText ?? fallbackResponse.text,
      llm: turn.llmMeta ?? fallbackResponse.llm
    }
  };
}

async function withResponse(turn, { message, context, options }) {
  const fallbackResponse = composeResponse(turn);
  options.onTurnReady?.({
    ...turn,
    response: fallbackResponse,
    fallbackResponse
  });
  const response = await maybeEnhanceResponse({
    message,
    context,
    turn,
    fallbackResponse,
    options
  });

  return {
    ...turn,
    response,
    fallbackResponse
  };
}

async function maybeEnhanceResponse({ message, context, turn, fallbackResponse, options }) {
  if (!shouldUseLlmResponse(turn)) {
    return fallbackResponse;
  }

  const responseEnhancer = options.responseEnhancer ?? enhanceAgentTurnResponse;
  if (typeof responseEnhancer !== "function") {
    return fallbackResponse;
  }

  try {
    return await responseEnhancer({
      message,
      context,
      turn,
      fallbackResponse,
      onTextDelta: options.onTextDelta,
      signal: options.signal
    });
  } catch (error) {
    return attachLlmFallbackInfo(fallbackResponse, error, turn);
  }
}

function shouldUseLlmResponse(turn) {
  return turn.toolResult?.type !== "error";
}

function shouldUseLlmAgentLoop(message, context, options) {
  if (typeof options.responseEnhancer === "function") {
    return false;
  }

  if (context?.llmSettings?.enabled === false || !context?.llmSettings) {
    return false;
  }

  if (context.llmSettings.capabilities?.tools === false) {
    return false;
  }

  return isLikelyToolDrivenTurn(message, context);
}

function isLikelyToolDrivenTurn(message, context) {
  const detected = detectIntent(message);
  if (detected.type !== "chat") {
    return true;
  }

  const rawMessage = String(message ?? "");
  return Boolean(
    context.currentSolveReview
    || shouldInspectSelectedSegment(message, context)
    || /scramble|timedMoves|segmentedSolution|OLL|PLL|Cross|F2L|公式|推荐|复盘|分析/i.test(rawMessage)
    || BARE_PLL_CASE_PATTERN.test(rawMessage)
  );
}

function attachLlmFallbackInfo(fallbackResponse, error, turn) {
  const code = error?.code ?? "LLM_UNKNOWN_ERROR";
  const userError = getUserFacingLlmError(error);
  const llmMeta = {
    enabled: false,
    status: code === "LLM_ABORTED" ? "cancelled" : "fallback",
    source: turn.response?.llm?.source ?? "openai-compatible",
    error: {
      code,
      message: userError.message,
      detail: userError.detail
    }
  };

  if (code === "LLM_ABORTED") {
    return {
      ...fallbackResponse,
      llm: llmMeta
    };
  }

  if (turn.toolResult?.type === "chat") {
    return {
      ...fallbackResponse,
      text: buildChatLlmFallbackText(error),
      llm: llmMeta
    };
  }

  return {
    ...fallbackResponse,
    llm: llmMeta
  };
}

async function runSolveImport(intent, context) {
  if (!intent.params.scramble) {
    return {
      intent,
      toolCalls: [],
      toolResult: {
        type: "error",
        code: "MISSING_SCRAMBLE",
        message: "导入 solve 需要提供 scramble。",
        details: [
          {
            label: "缺少字段",
            value: "scramble"
          }
        ]
      },
      contextPatch: {
        lastImportError: {
          code: "MISSING_SCRAMBLE",
          message: "导入 solve 需要提供 scramble。"
        }
      }
    };
  }

  let review;
  try {
    review = await createSolveReview(intent.params);
  } catch (error) {
    const importError = formatSolveImportError(error);
    return {
      intent,
      toolCalls: [
        {
          name: "createSolveReview",
          args: sanitizeSolveArgs(intent.params),
          status: "error",
          result: {
            type: "error",
            code: importError.code,
            message: importError.message
          }
        }
      ],
      toolResult: {
        type: "error",
        ...importError
      },
      contextPatch: {
        lastImportError: importError
      }
    };
  }

  return {
    intent,
    toolCalls: [
      {
        name: "createSolveReview",
        args: sanitizeSolveArgs(intent.params),
        status: "completed",
        result: {
          type: "solve-review",
          summary: review.summary,
          validation: review.validation,
          segmentation: review.segmentation
        }
      }
    ],
    toolResult: {
      type: "solve-review",
      review
    },
    contextPatch: {
      currentSolveReview: review,
      lastImportError: null,
      selectedSegmentId: null,
      lastIntent: intent.type,
      previousContextKeys: Object.keys(context)
    }
  };
}

function runAlgorithmQuery(intent) {
  const result = searchAlgorithms(intent.params);

  return {
    intent,
    toolCalls: [
      {
        name: "searchAlgorithms",
        args: intent.params,
        status: "completed",
        result: {
          type: "algorithm-search",
          total: result.total,
          query: result.query
        }
      }
    ],
    toolResult: {
      type: "algorithm-search",
      result
    },
    contextPatch: {
      lastAlgorithmQuery: intent.params
    }
  };
}

function runLocalFollowup(intent, context) {
  const review = context.currentSolveReview;
  if (!review) {
    return {
      intent,
      toolCalls: [],
      toolResult: {
        type: "error",
        code: "NO_SOLVE_CONTEXT",
        message: "当前没有已导入的 solve，无法回答局部追问。"
      },
      contextPatch: {}
    };
  }

  const segment = intent.params.selectedSegmentId
    ? review.segments.find((item) => item.id === intent.params.selectedSegmentId)
    : findSegment(review, intent.params.segmentLabel);
  if (!segment) {
    return {
      intent,
      toolCalls: [],
      toolResult: {
        type: "error",
        code: "SEGMENT_NOT_FOUND",
        message: `未找到分段：${intent.params.segmentLabel ?? intent.params.selectedSegmentId ?? "未指定"}`
      },
      contextPatch: {}
    };
  }

  const stage = review.cfopAnalysis.stages.find((item) => item.segmentId === segment.id);
  const suggestions = review.coachSuggestions.suggestions.filter((suggestion) => suggestion.target?.segmentId === segment.id);

  return {
    intent,
    toolCalls: [
      {
        name: "readSolveContext",
        args: {
          segmentLabel: segment.label
        },
        status: "completed",
        result: {
          type: "segment-inspection",
          segmentId: segment.id,
          label: segment.label,
          goal: stage?.goal ?? null
        }
      }
    ],
    toolResult: {
      type: "segment-inspection",
      segment,
      stage,
      suggestions
    },
    contextPatch: {
      selectedSegmentId: segment.id,
      lastIntent: intent.type
    }
  };
}

function findSegment(review, label) {
  if (!label) {
    return null;
  }
  const normalizedLabel = label.toLowerCase().replace(/\s+/g, " ").trim();
  return review.segments.find((segment) => segment.label.toLowerCase().replace(/\s+/g, " ").trim() === normalizedLabel);
}

function shouldInspectSelectedSegment(message, context) {
  return Boolean(
    context.currentSolveReview
    && context.selectedSegmentId
    && /这里|这段|这个阶段|刚才选中|当前阶段|怎么看|为什么慢|问题|建议/.test(String(message ?? ""))
  );
}

function formatSolveImportError(error) {
  const message = String(error?.message ?? error ?? "未知导入错误");

  if (/timedMoves 不能为空/.test(message)) {
    return {
      code: "EMPTY_TIMED_MOVES",
      message: "没有识别到 timedMoves。",
      details: [
        { label: "需要格式", value: "timedMoves: U@0 R@120 ..." }
      ]
    };
  }

  const illegalTimedMove = message.match(/非法 timed move：(.+)/);
  if (illegalTimedMove) {
    return {
      code: "INVALID_TIMED_MOVE",
      message: "timedMoves 中有无法识别的转动。",
      details: [
        { label: "问题 token", value: illegalTimedMove[1] },
        { label: "格式", value: "move@timestamp，例如 R@250" }
      ]
    };
  }

  const timestampOrder = message.match(/timestamp 必须递增：(.+)/);
  if (timestampOrder) {
    return {
      code: "TIMESTAMP_ORDER",
      message: "timestamp 必须按时间递增。",
      details: [
        { label: "问题 token", value: timestampOrder[1] }
      ]
    };
  }

  const illegalMove = message.match(/非法 move：(.+)/);
  if (illegalMove) {
    return {
      code: "INVALID_SEGMENT_MOVE",
      message: "分段解法中有无法识别的 move。",
      details: [
        { label: "问题 move", value: illegalMove[1] }
      ]
    };
  }

  const missingSegmentLabel = message.match(/分段行缺少 \/\/ label：(.+)/);
  if (missingSegmentLabel) {
    return {
      code: "MISSING_SEGMENT_LABEL",
      message: "分段行缺少 // 阶段名。",
      details: [
        { label: "问题行", value: missingSegmentLabel[1] },
        { label: "示例", value: "R U R' // F2L 1" }
      ]
    };
  }

  return {
    code: "SOLVE_IMPORT_FAILED",
    message,
    details: []
  };
}

function sanitizeSolveArgs(params) {
  return {
    puzzle: params.puzzle,
    source: params.source,
    scramble: params.scramble,
    timedMovesLength: params.timedMoves?.length ?? 0,
    hasSegmentedSolution: Boolean(params.segmentedSolution)
  };
}
