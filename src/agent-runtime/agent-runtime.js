import { createSolveReview, searchAlgorithms } from "../cubing-tools/index.js";
import { detectIntent } from "./intent-detector.js";
import { composeResponse } from "./response-composer.js";

export async function runAgentTurn(message, context = {}) {
  const intent = detectIntent(message);
  let turn;

  if (intent.type === "solve-import") {
    turn = await runSolveImport(intent, context);
    return withResponse(turn);
  }

  if (intent.type === "algorithm-query") {
    turn = runAlgorithmQuery(intent, context);
    return withResponse(turn);
  }

  if (intent.type === "local-followup") {
    turn = runLocalFollowup(intent, context);
    return withResponse(turn);
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
  return withResponse(turn);
}

function withResponse(turn) {
  return {
    ...turn,
    response: composeResponse(turn)
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
        message: "导入 solve 需要提供 scramble。"
      },
      contextPatch: {}
    };
  }

  const review = await createSolveReview(intent.params);

  return {
    intent,
    toolCalls: [
      {
        name: "createSolveReview",
        args: sanitizeSolveArgs(intent.params)
      }
    ],
    toolResult: {
      type: "solve-review",
      review
    },
    contextPatch: {
      currentSolveReview: review,
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
        args: intent.params
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

  const segment = findSegment(review, intent.params.segmentLabel);
  if (!segment) {
    return {
      intent,
      toolCalls: [],
      toolResult: {
        type: "error",
        code: "SEGMENT_NOT_FOUND",
        message: `未找到分段：${intent.params.segmentLabel}`
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
          segmentLabel: intent.params.segmentLabel
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
  const normalizedLabel = label.toLowerCase().replace(/\s+/g, " ").trim();
  return review.segments.find((segment) => segment.label.toLowerCase().replace(/\s+/g, " ").trim() === normalizedLabel);
}

function sanitizeSolveArgs(params) {
  return {
    puzzle: params.puzzle,
    source: params.source,
    scramble: params.scramble,
    timedMovesLength: params.timedMoves.length,
    hasSegmentedSolution: Boolean(params.segmentedSolution)
  };
}
