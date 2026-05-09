import { searchAlgorithms } from "./algorithm-search.js";
import { buildAlgCubingNetUrl, buildPlaybackBBCode } from "./playback-url.js";

const DEFAULT_SLOW_TPS = 3;
const DEFAULT_OP_RECOMMENDATION_GAP = 3;

export function generateCoachSuggestions(review, {
  slowTpsThreshold = DEFAULT_SLOW_TPS,
  opRecommendationGap = DEFAULT_OP_RECOMMENDATION_GAP,
  algorithmTags = []
} = {}) {
  const suggestions = [
    ...buildValidationSuggestions(review),
    ...buildStageGoalSuggestions(review),
    ...buildPauseSuggestions(review),
    ...buildSlowStageSuggestions(review, slowTpsThreshold),
    ...buildAlgorithmSuggestions(review, algorithmTags, opRecommendationGap)
  ];

  return {
    version: 1,
    assumptions: [
      "建议基于确定性工具输出生成，LLM 只负责解释和排序话术。",
      "当前只对已识别的 OLL / PLL 做公式推荐，F2L 暂不做 case 识别和公式推荐。",
      "当前公式建议只来自本地小型样例库。"
    ],
    suggestions: suggestions.map((suggestion, index) => ({
      id: `suggestion-${index + 1}`,
      ...suggestion
    }))
  };
}

function buildValidationSuggestions(review) {
  return review.validation.warnings.map((warning) => ({
    type: "input-validation",
    priority: "high",
    title: "输入数据需要先核对",
    target: null,
    evidence: [warning.message],
    action: "先修正分段文本与 timedMoves 的对应关系，再进行阶段复盘。"
  }));
}

function buildStageGoalSuggestions(review) {
  return review.cfopAnalysis.stages
    .filter((stage) => stage.goal && !stage.goal.completed)
    .map((stage) => ({
      type: "stage-goal",
      priority: stage.stageType === "unknown" ? "low" : "high",
      title: `${stage.label} 阶段目标未完成`,
      target: {
        segmentId: stage.segmentId,
        stageType: stage.stageType
      },
      evidence: [stage.goal.evidence],
      action: "优先复查该阶段分段是否正确；如果分段正确，再分析该阶段的具体状态变化。"
    }));
}

function buildPauseSuggestions(review) {
  return review.segments
    .filter((segment) => segment.pauses.length > 0)
    .map((segment) => {
      const longestPause = Math.max(...segment.pauses.map((move) => move.deltaMs));
      const primaryWindow = segment.pauseWindows.find((window) => window.deltaMs === longestPause) ?? segment.pauseWindows[0];
      const windowEvidence = primaryWindow
        ? `停顿窗口：${formatMoveWindow(primaryWindow.previousMoves, primaryWindow.move, primaryWindow.nextMoves)}`
        : null;
      const stateEvidence = primaryWindow?.stateSummary
        ? formatPauseStateSummary(primaryWindow.stateSummary)
        : null;
      return {
        type: "pause",
        priority: longestPause >= 800 ? "high" : "medium",
        title: `${segment.label} 有明显停顿`,
        target: {
          segmentId: segment.id,
          startMove: segment.startMove,
          endMove: segment.endMove
        },
        evidence: [
          `${segment.label} 有 ${segment.pauses.length} 个超过 ${review.summary.pauseThresholdMs}ms 的停顿`,
          `最长停顿 ${longestPause}ms`,
          ...(windowEvidence ? [windowEvidence] : []),
          ...(stateEvidence ? [stateEvidence] : [])
        ],
        action: "优先回看最长停顿前后的 cube state 和下一步选择。"
      };
    });
}

function buildSlowStageSuggestions(review, slowTpsThreshold) {
  return review.cfopAnalysis.stages
    .filter((stage) => stage.durationMs > 0 && stage.tps > 0 && stage.tps < slowTpsThreshold)
    .map((stage) => ({
      type: "tempo",
      priority: "medium",
      title: `${stage.label} TPS 偏低`,
      target: {
        segmentId: stage.segmentId,
        stageType: stage.stageType
      },
      evidence: [
        `${stage.label} 用 ${stage.moveCount} moves，耗时 ${stage.durationMs}ms，TPS ${stage.tps}`
      ],
      action: "先检查是否存在观察停顿，再考虑替换更顺手的公式或插入方式。"
    }));
}

function buildAlgorithmSuggestions(review, algorithmTags, opRecommendationGap) {
  return review.cfopAnalysis.stages.flatMap((stage) => {
    const segment = review.segments.find((item) => item.id === stage.segmentId);
    const query = buildAlgorithmQuery(stage, algorithmTags);
    if (!query) {
      return [];
    }

    const candidates = searchStageAlgorithms(query);
    if (!candidates.total) {
      return [];
    }

    const bestCandidate = candidates.results[0];
    const actualEffectiveMoveCount = segment?.effectiveMoveCount ?? stage.effectiveMoveCount ?? stage.moveCount;
    const recommendedEffectiveMoveCount = bestCandidate.metrics.effectiveMoveCount ?? bestCandidate.metrics.moveCount;
    const moveGap = actualEffectiveMoveCount - recommendedEffectiveMoveCount;

    if (moveGap < opRecommendationGap) {
      return [];
    }

      const candidatesWithPlayback = candidates.results.map((candidate) => ({
        ...candidate,
        playback: {
          url: buildAlgCubingNetUrl({
            setup: segment?.displaySetupAlg ?? segment?.setupAlg ?? review.scramble,
            alg: candidate.alg
          }),
          bbcode: buildPlaybackBBCode({
            setup: segment?.displaySetupAlg ?? segment?.setupAlg ?? review.scramble,
            alg: candidate.alg,
          label: candidate.name
        })
        }
      }));

    return [{
      type: "algorithm-candidates",
      priority: "medium",
      title: `${stage.label} 可参考候选公式`,
      target: {
        segmentId: stage.segmentId,
        stageType: stage.stageType
      },
      evidence: [
        `当前实际使用约 ${actualEffectiveMoveCount} 步，已按相邻同轴合并与抵消规则归并`,
        `库内首选候选约 ${recommendedEffectiveMoveCount} 步，少了 ${moveGap} 步`,
        `本地公式库命中 ${candidates.total} 条候选`
      ],
      action: "可以先对比当前公式与候选公式的步数和转动结构，再结合手法偏好决定是否替换。",
      candidates: candidatesWithPlayback
    }];
  });
}

function buildAlgorithmQuery(stage, algorithmTags) {
  if (stage.stageType === "oll") {
    const recognizedOllCaseId = stage.recognition?.oll?.matched ? stage.recognition.oll.caseId : null;
    if (!recognizedOllCaseId) {
      return null;
    }
    return {
      set: "OLL",
      caseId: recognizedOllCaseId,
      tags: algorithmTags
    };
  }

  if (stage.stageType === "pll") {
    const recognizedPllCaseId = stage.recognition?.pll?.matched ? stage.recognition.pll.caseId : null;
    if (!recognizedPllCaseId) {
      return null;
    }
    return {
      set: "PLL",
      caseId: recognizedPllCaseId,
      tags: algorithmTags
    };
  }

  return null;
}

function searchStageAlgorithms(query) {
  const primary = searchAlgorithms({ ...query, limit: 3 });
  if (primary.total || !query.caseId || !query.tags.length) {
    return primary;
  }

  return searchAlgorithms({
    ...query,
    tags: query.tags.filter((tag) => tag !== "no-rotation"),
    limit: 3
  });
}

function formatMoveWindow(previousMoves, currentMove, nextMoves) {
  const before = previousMoves.join(" ");
  const after = nextMoves.join(" ");

  if (before && after) {
    return `${before} [${currentMove}] ${after}`;
  }
  if (before) {
    return `${before} [${currentMove}]`;
  }
  if (after) {
    return `[${currentMove}] ${after}`;
  }
  return `[${currentMove}]`;
}

function formatPauseStateSummary(stateSummary) {
  if (stateSummary.readableSummary) {
    return `状态摘要：${stateSummary.readableSummary}`;
  }

  const metrics = stateSummary.goalProgress
    ? Object.entries(stateSummary.goalProgress)
      .map(([key, value]) => `${key}=${value}`)
      .join("，")
    : "";

  return metrics ? `状态摘要：${metrics}` : "";
}
