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

  const selectedOrientation = selectBestOrientation(stateTrace);
  const progressTrace = [
    {
      moveIndex: -1,
      progress: stateTrace.afterScramble.cf4opProgressByOrientation[selectedOrientation]
    }
  ];

  let currentProgress = progressTrace[0].progress;
  let segmentStartIndex = 0;
  const segments = [];

  for (const move of moves) {
    const timelineState = stateTrace.timeline[move.index];
    const progress = timelineState.cf4opProgressByOrientation[selectedOrientation];
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
    orientationIndex: selectedOrientation,
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

function selectBestOrientation(stateTrace) {
  const orientationCount = stateTrace.afterScramble.cf4opProgressByOrientation.length;
  const candidates = [];

  for (let orientationIndex = 0; orientationIndex < orientationCount; orientationIndex += 1) {
    const values = [
      stateTrace.afterScramble.cf4opProgressByOrientation[orientationIndex],
      ...stateTrace.timeline.map((entry) => entry.cf4opProgressByOrientation[orientationIndex])
    ];
    candidates.push({
      orientationIndex,
      score: scoreOrientation(values)
    });
  }

  candidates.sort(compareOrientationScore);
  return candidates[0]?.orientationIndex ?? 0;
}

function scoreOrientation(values) {
  let increaseCount = 0;
  let decreaseCount = 0;
  let increaseMagnitude = 0;

  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta > 0) {
      increaseCount += 1;
      increaseMagnitude += delta;
    } else if (delta < 0) {
      decreaseCount += 1;
    }
  }

  return {
    increaseCount,
    increaseMagnitude,
    finalProgress: values.at(-1) ?? 7,
    startProgress: values[0] ?? 7,
    decreaseCount
  };
}

function compareOrientationScore(left, right) {
  return left.score.increaseCount - right.score.increaseCount
    || left.score.increaseMagnitude - right.score.increaseMagnitude
    || left.score.finalProgress - right.score.finalProgress
    || right.score.startProgress - left.score.startProgress
    || right.score.decreaseCount - left.score.decreaseCount
    || left.orientationIndex - right.orientationIndex;
}

function normalizeSegmentId(label, index) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `segment-${index + 1}`;
}
