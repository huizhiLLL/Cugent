import { parseSegmentedSolution, parseTimedMoves } from "./parsers.js";
import { buildAlgCubingNetUrl, buildPlaybackBBCode } from "./playback-url.js";

export function createSolveReview({
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
  const parsedSegments = parseSegmentedSolution(segmentedSolution);
  const segments = assignSegments(moves, parsedSegments, pauseThresholdMs);
  const solutionAlg = moves.map((item) => item.move).join(" ");

  return {
    puzzle,
    source,
    scramble,
    rawInput: {
      timedMoves,
      segmentedSolution
    },
    summary: buildSummary(moves, pauseThresholdMs),
    moves,
    segments,
    playback: {
      url: buildAlgCubingNetUrl({ setup: scramble, alg: solutionAlg }),
      bbcode: buildPlaybackBBCode({ setup: scramble, alg: solutionAlg, label: "Full solve" })
    }
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
      playback: {
        url: buildAlgCubingNetUrl({ alg: segment.moves.join(" ") }),
        bbcode: buildPlaybackBBCode({ alg: segment.moves.join(" "), label: segment.label })
      }
    };
  });
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
