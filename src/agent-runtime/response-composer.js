export function composeResponse(agentTurn) {
  const { toolResult, toolCalls = [] } = agentTurn;

  if (toolResult.type === "solve-review") {
    return composeSolveReviewResponse(toolResult.review, toolCalls);
  }

  if (toolResult.type === "algorithm-search") {
    return composeAlgorithmSearchResponse(toolResult.result, toolCalls);
  }

  if (toolResult.type === "segment-inspection") {
    return composeSegmentInspectionResponse(toolResult, toolCalls);
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

function composeSolveReviewResponse(review, toolCalls) {
  const topSuggestions = review.coachSuggestions.suggestions
    .filter((suggestion) => shouldShowSolveReviewHighlight(suggestion))
    .slice(0, 3);
  const ollRecognition = review.segments.find((segment) => segment.label.trim().toLowerCase() === "oll")?.recognition?.oll;
  const pllRecognition = review.segments.find((segment) => segment.label.trim().toLowerCase() === "pll")?.recognition?.pll;
  const evidence = [
    `总步数 ${review.summary.totalMoves}，总耗时 ${review.summary.totalDurationMs}ms，TPS ${review.summary.totalTps}`,
    `最终状态：${review.stateTrace.final.isSolved ? "已复原" : "未复原"}`,
    `输入校验：${review.validation.ok ? "通过" : "存在 warning"}`
  ];

  if (ollRecognition?.matched) {
    evidence.push(`OLL 识别：${ollRecognition.caseId} (${ollRecognition.name})`);
  }
  if (pllRecognition?.matched) {
    evidence.push(`PLL 识别：${pllRecognition.caseId} (${pllRecognition.name})`);
  }

  return {
    kind: "solve-review",
    text: `我已经导入这次 ${review.puzzle} solve，并生成了阶段分析和 ${review.coachSuggestions.suggestions.length} 条结构化建议。`,
    evidence,
    highlights: topSuggestions.map(formatSuggestion),
    toolCalls: normalizeToolCalls(toolCalls),
    playback: review.playback.bbcode,
    nextActions: [
      "可以继续问某个阶段，例如“F2L 1 这里怎么看”。",
      "也可以要求查询某个 OLL/PLL 公式。"
    ]
  };
}

function composeAlgorithmSearchResponse(result, toolCalls) {
  if (!result.total) {
    return {
      kind: "algorithm-search",
      text: "没有找到符合条件的推荐公式。",
      evidence: [formatQuery(result.query)],
      recommendedAlgorithms: [],
      nextActions: ["可以放宽 tags 条件，或补充更多公式数据。"]
    };
  }

  const recommendedAlgorithms = result.results.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    alg: candidate.alg,
    evidence: `${candidate.metrics.moveCount} moves，${candidate.metrics.hasRotation ? "有转体" : "无转体"}，slice moves ${candidate.metrics.sliceMoves}`,
    playback: candidate.playback?.bbcode,
    playbackUrl: candidate.playback?.url
  }));

  return {
    kind: "algorithm-search",
    text: `找到 ${result.total} 条推荐公式。`,
    evidence: [formatQuery(result.query)],
    recommendedAlgorithms,
    toolCalls: normalizeToolCalls(toolCalls),
    nextActions: ["后续可以结合真实 case 识别和你的手法偏好再排序。"]
  };
}

function composeSegmentInspectionResponse({ segment, stage, suggestions }, toolCalls) {
  const evidence = [
    `${segment.label}：${segment.moveCount} moves，${segment.durationMs}ms，TPS ${segment.tps}`,
    `阶段目标：${stage.goal.completed ? "完成" : "未完成"}，${stage.goal.evidence}`,
    `停顿数：${segment.pauses.length}`
  ];

  const pllRecognition = segment.recognition?.pll;
  const ollRecognition = segment.recognition?.oll;
  if (ollRecognition?.matched) {
    evidence.push(`OLL 识别：${ollRecognition.caseId} (${ollRecognition.name})`);
  }
  if (pllRecognition?.matched) {
    evidence.push(`PLL 识别：${pllRecognition.caseId} (${pllRecognition.name})`);
  }

  return {
    kind: "segment-inspection",
    text: `我看了 ${segment.label} 这一段，下面是基于工具结果的局部证据。`,
    evidence,
    highlights: suggestions.map(formatSuggestion),
    toolCalls: normalizeToolCalls(toolCalls),
    playback: segment.playback?.bbcode ?? null,
    nextActions: [
      "可以继续要求对比推荐公式。",
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
    recommendedAlgorithms: suggestion.recommendedAlgorithms?.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      alg: candidate.alg,
      playback: candidate.playback?.bbcode,
      playbackUrl: candidate.playback?.url
    })) ?? []
  };
}

function shouldShowSolveReviewHighlight(suggestion) {
  if (suggestion.type === "pause") {
    return false;
  }

  if (suggestion.type === "algorithm-recommendations") {
    return suggestion.target?.stageType === "oll" || suggestion.target?.stageType === "pll";
  }

  return true;
}

function formatQuery(query) {
  return `查询条件：set=${query.set ?? "any"}，caseId=${query.caseId ?? "any"}，tags=${query.tags.length ? query.tags.join(", ") : "none"}`;
}

function normalizeToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : []).map((toolCall) => ({
    name: toolCall.name ?? "unknown",
    args: toolCall.args ?? {},
    status: toolCall.status ?? "completed",
    result: toolCall.result ?? null
  }));
}
