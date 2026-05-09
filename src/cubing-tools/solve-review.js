import { parseSegmentedSolution, parseTimedMoves } from "./parsers.js";
import { Alg } from "cubing/alg";
import { calculateEffectiveMoveCount, simplifyAlgMoves } from "./alg-metrics.js";
import { buildAlgCubingNetUrl, buildPlaybackBBCode } from "./playback-url.js";
import { analyzeCFOP } from "./cfop-analyzer.js";
import { generateCoachSuggestions } from "./coach-suggestions.js";
import { inferCf4opSegments } from "./cfop-inference.js";
import { identifyOllCaseFromPatternData } from "./oll-recognition.js";
import { identifyPllCaseFromPatternData } from "./pll-recognition.js";
import { traceCubeState } from "./state-tracer.js";

export async function createSolveReview({
  puzzle = "333",
  source = "manual",
  scramble,
  timedMoves,
  segmentedSolution,
  pauseThresholdMs = 500,
  onProgress
}) {
  if (!scramble || !scramble.trim()) {
    throw new Error("scramble 为必填项");
  }

  onProgress?.({
    stage: "parse-review",
    phase: "parse-review",
    text: "正在解析回顾。"
  });
  const moves = parseTimedMoves(timedMoves);
  const providedSegments = parseSegmentedSolution(segmentedSolution);
  const solutionAlg = moves.map((item) => item.move).join(" ");

  onProgress?.({
    stage: "trace-state",
    phase: "trace-state",
    text: "正在追踪魔方状态。"
  });
  const stateTrace = await traceCubeState({ scramble, solution: solutionAlg });

  onProgress?.({
    stage: "infer-segmentation",
    phase: "infer-segmentation",
    text: "正在推断分段。"
  });
  const segmentation = providedSegments.length
    ? {
      source: "provided",
      method: "manual",
      confidence: 1
    }
    : inferCf4opSegments({ moves, stateTrace });
  const parsedSegments = providedSegments.length ? providedSegments : segmentation.segments;
  const validation = providedSegments.length
    ? validateSegmentAlignment(moves, providedSegments)
    : {
      ok: true,
      warnings: []
    };

  onProgress?.({
    stage: "build-stages",
    phase: "build-stages",
    text: "正在整理阶段结果。"
  });
  const segments = assignSegments(moves, parsedSegments, pauseThresholdMs, scramble);
  const segmentsWithState = await attachSegmentStates(segments, stateTrace);
  const baseReview = {
    puzzle,
    source,
    scramble,
    rawInput: {
      timedMoves,
      segmentedSolution
    },
    summary: buildSummary(moves, pauseThresholdMs),
    segmentation,
    validation,
    moves,
    segments: segmentsWithState,
    stateTrace,
    playback: {
      url: buildAlgCubingNetUrl({ setup: scramble, alg: solutionAlg }),
      bbcode: buildPlaybackBBCode({ setup: scramble, alg: solutionAlg, label: "Full solve" })
    }
  };

  const reviewWithAnalysis = {
    ...baseReview,
    cfopAnalysis: await analyzeCFOP(baseReview)
  };

  return {
    ...reviewWithAnalysis,
    coachSuggestions: generateCoachSuggestions(reviewWithAnalysis)
  };
}

function validateSegmentAlignment(moves, parsedSegments) {
  const warnings = [];
  const flattenedSegmentMoves = parsedSegments.flatMap((segment) => segment.moves);

  if (!parsedSegments.length) {
    warnings.push({
      code: "NO_SEGMENTS",
      message: "未提供分段解法文本，只能输出整段 timeline 与总览指标。"
    });
  }

  if (flattenedSegmentMoves.length !== moves.length) {
    warnings.push({
      code: "SEGMENT_MOVE_COUNT_MISMATCH",
      message: `分段 move 数为 ${flattenedSegmentMoves.length}，timedMoves 数为 ${moves.length}。`
    });
  }

  const maxComparableMoves = Math.min(flattenedSegmentMoves.length, moves.length);
  for (let index = 0; index < maxComparableMoves; index += 1) {
    if (flattenedSegmentMoves[index] !== moves[index].move) {
      warnings.push({
        code: "SEGMENT_MOVE_MISMATCH",
        message: `第 ${index + 1} 步不一致：分段为 ${flattenedSegmentMoves[index]}，timedMoves 为 ${moves[index].move}。`,
        index,
        segmentedMove: flattenedSegmentMoves[index],
        timedMove: moves[index].move
      });
      break;
    }
  }

  return {
    ok: warnings.length === 0,
    warnings
  };
}

function assignSegments(moves, parsedSegments, pauseThresholdMs, scramble) {
  let cursor = 0;

  return parsedSegments.map((segment) => {
    const startMove = cursor;
    const endMove = cursor + segment.moveCount - 1;
    const segmentMoves = moves.slice(startMove, endMove + 1);
    const setupMoves = moves.slice(0, startMove).map((move) => move.move);
    const setupAlg = [scramble, ...setupMoves].filter(Boolean).join(" ").trim();
    const simplifiedMoves = simplifyAlgMoves(segment.moves);

    for (const move of segmentMoves) {
      move.segmentId = segment.id;
    }

    cursor += segment.moveCount;

    const durationMs = segmentMoves.reduce((sum, move) => sum + move.deltaMs, 0);

    return {
      ...segment,
      startMove,
      endMove,
      durationMs,
      tps: calculateTps(segmentMoves.length, durationMs),
      setupAlg,
      effectiveMoveCount: calculateEffectiveMoveCount(segment.moves),
      simplifiedMoves,
      pauses: segmentMoves.filter((move) => move.deltaMs >= pauseThresholdMs),
      pauseWindows: buildPauseWindows(segmentMoves, pauseThresholdMs),
      playback: buildSegmentPlayback(segment, setupAlg)
    };
  });
}

async function attachSegmentStates(segments, stateTrace) {
  return Promise.all(segments.map(async (segment) => {
    const beforeState = getStateBeforeMove(stateTrace, segment.startMove);
    const afterState = getStateAfterMove(stateTrace, segment.endMove);
    const segmentWithState = {
      ...segment,
      state: {
        before: beforeState,
        after: afterState,
        changed: beforeState.stateHash !== afterState.stateHash
      }
    };
    const recognition = await recognizeSegmentCase(segmentWithState);
    const displaySetupAlg = buildDisplaySetupAlg(segmentWithState.setupAlg, recognition);
    const displayAlg = buildDisplayAlg(segmentWithState.moves.join(" "), recognition);
    const pauseWindows = buildPauseWindowsWithState(segmentWithState, recognition);

    return {
      ...segmentWithState,
      displaySetupAlg,
      displayAlg,
      playback: buildSegmentPlayback(segmentWithState, displaySetupAlg, displayAlg),
      pauseWindows,
      recognition
    };
  }));
}

function getStateBeforeMove(stateTrace, moveIndex) {
  if (moveIndex <= 0) {
    return {
      moveIndex: null,
      patternData: stateTrace.afterScramble.patternData,
      stateHash: stateTrace.afterScramble.stateHash,
      isSolved: stateTrace.afterScramble.isSolved
    };
  }

  const previous = stateTrace.timeline[moveIndex - 1];
  return {
    moveIndex: previous.index,
    patternData: previous.patternData,
    stateHash: previous.stateHash,
    isSolved: previous.isSolved
  };
}

function getStateAfterMove(stateTrace, moveIndex) {
  const current = stateTrace.timeline[moveIndex];
  if (!current) {
    return {
      moveIndex: null,
      patternData: stateTrace.final.patternData,
      stateHash: stateTrace.final.stateHash,
      isSolved: stateTrace.final.isSolved
    };
  }

  return {
    moveIndex: current.index,
    patternData: current.patternData,
    stateHash: current.stateHash,
    isSolved: current.isSolved
  };
}

function buildSummary(moves, pauseThresholdMs) {
  const totalDurationMs = moves.at(-1)?.timestampMs ?? 0;
  const pauses = moves.filter((move) => move.deltaMs >= pauseThresholdMs);

  return {
    totalMoves: moves.length,
    totalDurationMs,
    totalTps: calculateTps(moves.length, totalDurationMs),
    longestPauseMs: Math.max(0, ...moves.map((move) => move.deltaMs)),
    pauseThresholdMs,
    pauseCount: pauses.length
  };
}

function calculateTps(moveCount, durationMs) {
  if (!durationMs) {
    return 0;
  }
  return Number((moveCount / (durationMs / 1000)).toFixed(2));
}

function buildSegmentPlayback(segment, setupAlg, displayAlg = "") {
  const alg = displayAlg || segment.moves.join(" ");
  if (!alg) {
    return null;
  }

  return {
    url: buildAlgCubingNetUrl({ setup: setupAlg, alg }),
    bbcode: buildPlaybackBBCode({ setup: setupAlg, alg, label: segment.label })
  };
}

function buildDisplaySetupAlg(setupAlg, recognition) {
  const orientation = recognition?.oll?.matched
    ? recognition.oll.orientation
    : recognition?.pll?.matched
      ? recognition.pll.orientation
      : null;

  if (!orientation || orientation === "identity") {
    return setupAlg;
  }

  return [setupAlg, orientation].filter(Boolean).join(" ").trim();
}

function buildDisplayAlg(alg, recognition) {
  const orientation = recognition?.oll?.matched
    ? recognition.oll.orientation
    : recognition?.pll?.matched
      ? recognition.pll.orientation
      : null;

  if (!orientation || orientation === "identity" || !alg.trim()) {
    return alg;
  }

  const inverseOrientation = new Alg(orientation).invert().toString();
  return new Alg([inverseOrientation, alg, orientation].filter(Boolean).join(" ")).toString();
}

function buildPauseWindows(segmentMoves, pauseThresholdMs) {
  return segmentMoves
    .filter((move) => move.deltaMs >= pauseThresholdMs)
    .map((move) => {
      const originalIndex = segmentMoves.findIndex((segmentMove) => segmentMove.index === move.index);
      return {
        moveIndex: move.index,
        deltaMs: move.deltaMs,
        move: move.move,
        previousMoves: segmentMoves.slice(Math.max(0, originalIndex - 2), originalIndex).map((segmentMove) => segmentMove.move),
        nextMoves: segmentMoves.slice(originalIndex + 1, originalIndex + 3).map((segmentMove) => segmentMove.move)
      };
    });
}

function buildPauseWindowsWithState(segment, recognition) {
  return segment.pauseWindows.map((window) => ({
    ...window,
    stateSummary: summarizePauseWindowState(segment, recognition)
  }));
}

function summarizePauseWindowState(segment, recognition) {
  const stageLabel = segment.label.trim();
  const normalizedLabel = stageLabel.toLowerCase();
  const beforePattern = segment.state.before.patternData;
  const summary = {
    stageLabel,
    beforeSolved: segment.state.before.isSolved,
    afterSolved: segment.state.after.isSolved,
    readableSummary: ""
  };

  if (normalizedLabel === "oll") {
    const goalProgress = summarizeOrientationProgress(beforePattern);
    summary.goalProgress = goalProgress;
    if (recognition?.oll?.matched) {
      summary.caseLabel = `${recognition.oll.caseId} (${recognition.oll.name})`;
    }
    summary.readableSummary = buildOllReadableSummary(goalProgress, summary.caseLabel);
    return summary;
  }

  if (normalizedLabel === "pll") {
    const goalProgress = summarizePermutationProgress(beforePattern);
    summary.goalProgress = goalProgress;
    if (recognition?.pll?.matched) {
      summary.caseLabel = `${recognition.pll.caseId} (${recognition.pll.name})`;
    }
    summary.readableSummary = buildPllReadableSummary(goalProgress, summary.caseLabel);
    return summary;
  }

  if (normalizedLabel.includes("f2l")) {
    const goalProgress = summarizeF2lProgress(beforePattern);
    summary.goalProgress = goalProgress;
    summary.readableSummary = buildF2lReadableSummary(goalProgress);
    return summary;
  }

  if (normalizedLabel === "cross") {
    const goalProgress = summarizeCrossProgress(beforePattern);
    summary.goalProgress = goalProgress;
    summary.readableSummary = buildCrossReadableSummary(goalProgress);
    return summary;
  }

  summary.goalProgress = {
    beforeStateHash: segment.state.before.stateHash,
    afterStateHash: segment.state.after.stateHash
  };
  summary.readableSummary = "停顿前后的状态已有记录，可继续结合回放细看。";
  return summary;
}

function summarizeCrossProgress(patternData) {
  const edges = patternData.EDGES;
  const solvedCrossEdges = [4, 5, 6, 7].filter((index) => edges.pieces[index] === index && edges.orientation[index] === 0).length;
  return {
    solvedCrossEdges
  };
}

function summarizeF2lProgress(patternData) {
  const corners = patternData.CORNERS;
  const edges = patternData.EDGES;
  const solvedCorners = [4, 5, 6, 7].filter((index) => corners.pieces[index] === index && corners.orientation[index] === 0).length;
  const solvedMiddleEdges = [8, 9, 10, 11].filter((index) => edges.pieces[index] === index && edges.orientation[index] === 0).length;
  return {
    solvedDLayerCorners: solvedCorners,
    solvedMiddleEdges
  };
}

function summarizeOrientationProgress(patternData) {
  const edges = patternData.EDGES;
  const corners = patternData.CORNERS;
  const orientedEdges = [0, 1, 2, 3].filter((index) => edges.orientation[index] === 0).length;
  const orientedCorners = [0, 1, 2, 3].filter((index) => corners.orientation[index] === 0).length;
  return {
    orientedULayerEdges: orientedEdges,
    orientedULayerCorners: orientedCorners
  };
}

function summarizePermutationProgress(patternData) {
  const edges = patternData.EDGES;
  const corners = patternData.CORNERS;
  const solvedTopEdges = [0, 1, 2, 3].filter((index) => edges.pieces[index] === index && edges.orientation[index] === 0).length;
  const solvedTopCorners = [0, 1, 2, 3].filter((index) => corners.pieces[index] === index && corners.orientation[index] === 0).length;
  return {
    solvedULayerEdges: solvedTopEdges,
    solvedULayerCorners: solvedTopCorners
  };
}

function buildCrossReadableSummary(goalProgress) {
  return `Cross 开始前底层十字已归位 ${goalProgress.solvedCrossEdges}/4。`;
}

function buildF2lReadableSummary(goalProgress) {
  return `F2L 开始前底层角已归位 ${goalProgress.solvedDLayerCorners}/4，中层棱已归位 ${goalProgress.solvedMiddleEdges}/4。`;
}

function buildOllReadableSummary(goalProgress, caseLabel) {
  const summary = `OLL 开始前顶层棱已定向 ${goalProgress.orientedULayerEdges}/4，顶层角已定向 ${goalProgress.orientedULayerCorners}/4。`;
  return caseLabel ? `${summary} 当前识别为 ${caseLabel}。` : summary;
}

function buildPllReadableSummary(goalProgress, caseLabel) {
  const summary = `PLL 开始前顶层棱已归位 ${goalProgress.solvedULayerEdges}/4，顶层角已归位 ${goalProgress.solvedULayerCorners}/4。`;
  return caseLabel ? `${summary} 当前识别为 ${caseLabel}。` : summary;
}


async function recognizeSegmentCase(segment) {
  const normalizedLabel = segment.label.trim().toLowerCase();

  if (normalizedLabel === "oll") {
    return {
      oll: await identifyOllCaseFromPatternData(segment.state.before.patternData)
    };
  }

  if (normalizedLabel === "pll") {
    return {
      pll: await identifyPllCaseFromPatternData(segment.state.before.patternData)
    };
  }

  return null;
}
