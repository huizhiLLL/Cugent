const CF4OP_STAGE_LABELS = {
  7: "Cross",
  6: "F2L 1",
  5: "F2L 2",
  4: "F2L 3",
  3: "F2L 4",
  2: "OLL",
  1: "PLL"
};

export function inferCf4opSegments({ moves, stateTrace }) {
  if (!moves.length) {
    return {
      source: "inferred-cf4op",
      method: "cf4op",
      confidence: 0,
      segments: []
    };
  }

  const progressTrace = [
    {
      moveIndex: -1,
      progress: stateTrace.afterScramble.cf4opProgress
    }
  ];

  let currentProgress = progressTrace[0].progress;
  let segmentStartIndex = 0;
  const segments = [];

  for (const move of moves) {
    const timelineState = stateTrace.timeline[move.index];
    const progress = timelineState.cf4opProgress;
    progressTrace.push({
      moveIndex: move.index,
      progress
    });

    if (progress < currentProgress) {
      const label = CF4OP_STAGE_LABELS[currentProgress] ?? "Cross";
      segments.push(createSegment(label, moves.slice(segmentStartIndex, move.index + 1), segments.length));
      currentProgress = progress;
      segmentStartIndex = move.index + 1;
    }
  }

  if (segmentStartIndex < moves.length) {
    const tailLabel = CF4OP_STAGE_LABELS[currentProgress] ?? "PLL";
    segments.push(createSegment(tailLabel, moves.slice(segmentStartIndex), segments.length));
  }

  return {
    source: "inferred-cf4op",
    method: "cf4op",
    orientationIndex: null,
    confidence: calculateConfidence({ progressTrace, finalSolved: stateTrace.final.isSolved }),
    progressTrace,
    segments
  };
}

function createSegment(label, segmentMoves, index) {
  return {
    id: normalizeSegmentId(label, index),
    label,
    moves: segmentMoves.map((move) => move.move),
    moveCount: segmentMoves.length
  };
}

function calculateConfidence({ progressTrace, finalSolved }) {
  const progressValues = progressTrace.map((entry) => entry.progress);
  const monotonic = progressValues.every((value, index) => index === 0 || value <= progressValues[index - 1]);
  if (finalSolved && monotonic) {
    return 0.93;
  }
  if (monotonic) {
    return 0.81;
  }
  return 0.64;
}

function normalizeSegmentId(label, index) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `segment-${index + 1}`;
}
