import { detectIntent } from "./intent-detector.js";
import { runLlmAgentLoop } from "./llm-agent-loop.js";
import { enhanceAgentTurnResponse } from "./llm-client.js";
import { buildChatLlmFallbackText, getUserFacingLlmError } from "./llm-error-presenter.js";
import { composeResponse } from "./response-composer.js";
import { executeAgentToolCall } from "./tool-registry.js";

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
      if (error?.code === "LLM_ABORTED") {
        return buildAbortedTurn(error);
      }

      if (!isConfigError(error?.code)) {
        console.warn("[agent-loop] fallback due to", error?.code, error?.message);
        options.onAgentEvent?.({
          type: "loop-error",
          phase: "fallback",
          code: error?.code ?? "LLM_UNKNOWN_ERROR",
          text: "AI 工具链路暂时不可用，已切回本地分析。"
        });
      }
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
    turn = await runAlgorithmQuery(intent, context);
    return withResponse(turn, { message, context, options });
  }

  if (intent.type === "local-followup") {
    turn = await runLocalFollowup(intent, context);
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

function buildAbortedTurn(error) {
  const userError = getUserFacingLlmError(error);
  const response = {
    kind: "chat-fallback",
    text: userError.message,
    evidence: [],
    nextActions: [],
    llm: {
      enabled: false,
      status: "cancelled",
      source: "openai-compatible",
      error: {
        code: "LLM_ABORTED",
        message: userError.message,
        detail: userError.detail
      }
    }
  };

  return {
    intent: {
      type: "chat",
      confidence: 0,
      params: {}
    },
    toolCalls: [],
    toolResult: {
      type: "chat",
      needsModelResponse: false,
      message: userError.message
    },
    contextPatch: {},
    response,
    fallbackResponse: response
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

function isConfigError(code) {
  return code === "LLM_DISABLED"
    || code === "LLM_BASE_URL_MISSING"
    || code === "LLM_API_KEY_MISSING"
    || code === "LLM_MODEL_MISSING";
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
  try {
    const execution = await executeAgentToolCall({
      name: "create_solve_review",
      args: intent.params,
      context
    });
    return buildToolTurn({
      intent,
      name: "create_solve_review",
      args: sanitizeSolveArgs(intent.params),
      execution
    });
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
}

async function runAlgorithmQuery(intent, context) {
  const execution = await executeAgentToolCall({
    name: "search_algorithms",
    args: intent.params,
    context
  });
  return buildToolTurn({
    intent,
    name: "search_algorithms",
    args: intent.params,
    execution
  });
}

async function runLocalFollowup(intent, context) {
  const execution = await executeAgentToolCall({
    name: "inspect_solve_segment",
    args: {
      segmentId: intent.params.selectedSegmentId,
      segmentLabel: intent.params.segmentLabel
    },
    context
  });
  return buildToolTurn({
    intent,
    name: "inspect_solve_segment",
    args: {
      segmentId: intent.params.selectedSegmentId,
      segmentLabel: intent.params.segmentLabel
    },
    execution
  });
}

function buildToolTurn({ intent, name, args, execution }) {
  const isError = execution.toolResult?.type === "error";
  return {
    intent,
    toolCalls: [
      {
        name,
        args,
        status: isError ? "error" : "completed",
        result: execution.content ?? execution.toolResult
      }
    ],
    toolResult: execution.toolResult,
    contextPatch: execution.contextPatch ?? {}
  };
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

  if (/导入 solve 需要提供 scramble/.test(message)) {
    return {
      code: "MISSING_SCRAMBLE",
      message: "导入 solve 需要提供 scramble。",
      details: [
        {
          label: "缺少字段",
          value: "scramble"
        }
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
