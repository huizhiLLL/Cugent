export function composeResponse(agentTurn) {
  const { toolResult } = agentTurn;

  if (toolResult.type === "solve-review") {
    return composeSolveReviewResponse(toolResult.review);
  }

  if (toolResult.type === "algorithm-search") {
    return composeAlgorithmSearchResponse(toolResult.result);
  }

  if (toolResult.type === "segment-inspection") {
    return composeSegmentInspectionResponse(toolResult);
  }

  if (toolResult.type === "error") {
    return {
      kind: "error",
      text: toolResult.message,
      evidence: toolResult.details?.map((detail) => `${detail.label}：${detail.value}`) ?? [],
      error: {
        code: toolResult.code,
        details: toolResult.details ?? []
      },
      nextActions: []
    };
  }

  return {
    kind: "chat-fallback",
    text: toolResult.message,
    evidence: [],
    nextActions: ["交给普通聊天模型继续回答。"]
  };
}

function composeSolveReviewResponse(review) {
  const topSuggestions = review.coachSuggestions.suggestions.slice(0, 3);
  const evidence = [
    `总步数 ${review.summary.totalMoves}，总耗时 ${review.summary.totalDurationMs}ms，TPS ${review.summary.totalTps}`,
    `最终状态：${review.stateTrace.final.isSolved ? "已复原" : "未复原"}`,
    `输入校验：${review.validation.ok ? "通过" : "存在 warning"}`
  ];

  return {
    kind: "solve-review",
    text: `我已经导入这次 ${review.puzzle} solve，并生成了阶段分析和 ${review.coachSuggestions.suggestions.length} 条结构化建议。`,
    evidence,
    highlights: topSuggestions.map(formatSuggestion),
    playback: review.playback.bbcode,
    nextActions: [
      "可以继续问某个阶段，例如“F2L 1 这里怎么看”。",
      "也可以要求查询某个 OLL/PLL 公式。"
    ]
  };
}

function composeAlgorithmSearchResponse(result) {
  if (!result.total) {
    return {
      kind: "algorithm-search",
      text: "本地公式库没有命中符合条件的候选。",
      evidence: [formatQuery(result.query)],
      candidates: [],
      nextActions: ["可以放宽 tags 条件，或补充本地公式库。"]
    };
  }

  const candidates = result.results.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    alg: candidate.alg,
    evidence: `${candidate.metrics.moveCount} moves，${candidate.metrics.hasRotation ? "有转体" : "无转体"}，slice moves ${candidate.metrics.sliceMoves}`,
    playback: candidate.playback?.bbcode
  }));

  return {
    kind: "algorithm-search",
    text: `本地公式库命中 ${result.total} 条候选。`,
    evidence: [formatQuery(result.query)],
    candidates,
    nextActions: ["后续可以结合真实 case 识别和你的手法偏好再排序。"]
  };
}

function composeSegmentInspectionResponse({ segment, stage, suggestions }) {
  const evidence = [
    `${segment.label}：${segment.moveCount} moves，${segment.durationMs}ms，TPS ${segment.tps}`,
    `阶段目标：${stage.goal.completed ? "完成" : "未完成"}，${stage.goal.evidence}`,
    `停顿数：${segment.pauses.length}`
  ];

  return {
    kind: "segment-inspection",
    text: `我看了 ${segment.label} 这一段，下面是基于工具结果的局部证据。`,
    evidence,
    highlights: suggestions.map(formatSuggestion),
    playback: segment.playback.bbcode,
    nextActions: [
      "可以继续要求对比候选公式。",
      "也可以打开这段的播放链接逐步看状态变化。"
    ]
  };
}

function formatSuggestion(suggestion) {
  return {
    id: suggestion.id,
    priority: suggestion.priority,
    title: suggestion.title,
    evidence: suggestion.evidence,
    action: suggestion.action,
    candidates: suggestion.candidates?.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      alg: candidate.alg,
      playback: candidate.playback?.bbcode
    })) ?? []
  };
}

function formatQuery(query) {
  return `查询条件：set=${query.set ?? "any"}，caseId=${query.caseId ?? "any"}，tags=${query.tags.length ? query.tags.join(", ") : "none"}`;
}
