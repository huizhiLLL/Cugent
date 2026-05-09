import { parseSegmentedSolution, parseTimedMoves } from "./parsers.js";
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
  pauseThresholdMs = 500
}) {
  if (!scramble || !scramble.trim()) {
    throw new Error("scramble 为必填项");
  }

  const moves = parseTimedMoves(timedMoves);
  const providedSegments = parseSegmentedSolution(segmentedSolution);
  const solutionAlg = moves.map((item) => item.move).join(" ");
  const stateTrace = await traceCubeState({ scramble, solution: solutionAlg });
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
  const segments = assignSegments(moves, parsedSegments, pauseThresholdMs);
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
    cfopAnalysis: analyzeCFOP(baseReview)
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

function assignSegments(moves, parsedSegments, pauseThresholdMs) {
  let cursor = 0;

  return parsedSegments.map((segment) => {
    const startMove = cursor;
    const endMove = cursor + segment.moveCount - 1;
    const segmentMoves = moves.slice(startMove, endMove + 1);

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
      pauses: segmentMoves.filter((move) => move.deltaMs >= pauseThresholdMs),
      playback: buildSegmentPlayback(segment)
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

    return {
      ...segmentWithState,
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

function buildSegmentPlayback(segment) {
  const alg = segment.moves.join(" ");
  if (!alg) {
    return null;
  }

  return {
    url: buildAlgCubingNetUrl({ alg }),
    bbcode: buildPlaybackBBCode({ alg, label: segment.label })
  };
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
