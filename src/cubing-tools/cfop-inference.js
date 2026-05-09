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
  const progressTrace = selectedOrientation.progressTrace;

  let currentProgress = progressTrace[0].progress;
  let segmentStartIndex = 0;
  const segments = [];

  for (const traceEntry of progressTrace.slice(1)) {
    const progress = traceEntry.progress;
    if (progress < currentProgress) {
      const label = CF4OP_STAGE_LABELS[currentProgress] ?? "Cross";
      segments.push(createSegment(label, moves.slice(segmentStartIndex, traceEntry.moveIndex + 1), segments.length));
      currentProgress = progress;
      segmentStartIndex = traceEntry.moveIndex + 1;
    }
  }

  if (segmentStartIndex < moves.length) {
    const tailLabel = CF4OP_STAGE_LABELS[currentProgress] ?? "PLL";
    segments.push(createSegment(tailLabel, moves.slice(segmentStartIndex), segments.length));
  }

  const normalizedSegments = postProcessSegments(segments);

  return {
    source: "inferred-cf4op",
    method: "cf4op",
    orientationIndex: selectedOrientation.orientationIndex,
    confidence: calculateConfidence({
      progressTrace,
      finalSolved: stateTrace.final.isSolved,
      finalProgress: selectedOrientation.finalProgress,
      breakthroughs: selectedOrientation.breakthroughs,
      rebounds: selectedOrientation.rebounds
    }),
    progressTrace,
    rawProgressTrace: selectedOrientation.rawProgressTrace,
    segments: normalizedSegments
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

function selectBestOrientation(stateTrace) {
  const orientationCount = getOrientationCount(stateTrace);
  const candidates = Array.from({ length: orientationCount }, (_, orientationIndex) => (
    buildOrientationCandidate(stateTrace, orientationIndex)
  ));

  candidates.sort(compareOrientationCandidates);

  const bestCandidate = candidates[0];
  return {
    ...bestCandidate,
    orientationIndex: orientationCount > 1 ? bestCandidate.orientationIndex : null
  };
}

function getOrientationCount(stateTrace) {
  return stateTrace.afterScramble.cf4opProgressByOrientation?.length
    || stateTrace.timeline[0]?.cf4opProgressByOrientation?.length
    || 1;
}

function buildOrientationCandidate(stateTrace, orientationIndex) {
  const rawProgressTrace = [
    {
      moveIndex: -1,
      progress: getProgressForOrientation(stateTrace.afterScramble, orientationIndex)
    }
  ];

  for (let timelineIndex = 0; timelineIndex < stateTrace.timeline.length; timelineIndex += 1) {
    const timelineState = stateTrace.timeline[timelineIndex];
    rawProgressTrace.push({
      moveIndex: timelineState.index ?? timelineIndex,
      progress: getProgressForOrientation(timelineState, orientationIndex)
    });
  }

  const progressTrace = normalizeProgressTrace(rawProgressTrace);
  const rawValues = rawProgressTrace.map((entry) => entry.progress);
  const normalizedValues = progressTrace.map((entry) => entry.progress);

  return {
    orientationIndex,
    rawProgressTrace,
    progressTrace,
    startProgress: normalizedValues[0],
    finalProgress: normalizedValues.at(-1),
    breakthroughs: countBreakthroughs(normalizedValues),
    rebounds: countRebounds(rawValues),
    totalProgress: normalizedValues.reduce((sum, value) => sum + value, 0),
    firstBreakthroughMoveIndex: findFirstBreakthroughMoveIndex(progressTrace),
    reachedSolved: normalizedValues.at(-1) === 0
  };
}

function getProgressForOrientation(stateSnapshot, orientationIndex) {
  return stateSnapshot.cf4opProgressByOrientation?.[orientationIndex]
    ?? stateSnapshot.cf4opProgress
    ?? 7;
}

function normalizeProgressTrace(rawProgressTrace) {
  let currentBest = rawProgressTrace[0].progress;
  return rawProgressTrace.map((entry) => {
    currentBest = Math.min(currentBest, entry.progress);
    return {
      moveIndex: entry.moveIndex,
      progress: currentBest
    };
  });
}

function countBreakthroughs(progressValues) {
  let breakthroughs = 0;
  for (let index = 1; index < progressValues.length; index += 1) {
    if (progressValues[index] < progressValues[index - 1]) {
      breakthroughs += 1;
    }
  }
  return breakthroughs;
}

function countRebounds(progressValues) {
  let rebounds = 0;
  for (let index = 1; index < progressValues.length; index += 1) {
    if (progressValues[index] > progressValues[index - 1]) {
      rebounds += 1;
    }
  }
  return rebounds;
}

function findFirstBreakthroughMoveIndex(progressTrace) {
  for (let index = 1; index < progressTrace.length; index += 1) {
    if (progressTrace[index].progress < progressTrace[index - 1].progress) {
      return progressTrace[index].moveIndex;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function compareOrientationCandidates(a, b) {
  return compareNumbers(a.finalProgress, b.finalProgress)
    || compareNumbers(b.breakthroughs, a.breakthroughs)
    || compareNumbers(a.rebounds, b.rebounds)
    || compareNumbers(a.totalProgress, b.totalProgress)
    || compareNumbers(a.firstBreakthroughMoveIndex, b.firstBreakthroughMoveIndex)
    || compareNumbers(a.orientationIndex, b.orientationIndex);
}

function compareNumbers(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function calculateConfidence({ finalSolved, finalProgress, breakthroughs, rebounds }) {
  let confidence = 0.5;

  if (finalSolved && finalProgress === 0) {
    confidence += 0.12;
  } else if (finalProgress <= 1) {
    confidence += 0.06;
  }

  confidence += Math.min(0.18, breakthroughs * 0.025);
  confidence += Math.max(0, 0.12 - (rebounds * 0.01));

  return Number(Math.max(0.4, Math.min(0.94, confidence)).toFixed(2));
}

function normalizeSegmentId(label, index) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `segment-${index + 1}`;
}

function postProcessSegments(segments) {
  const merged = [];

  for (const segment of segments) {
    if (!segment.moveCount) {
      continue;
    }

    const previous = merged.at(-1);
    if (shouldMergeShortSegment(segment, previous)) {
      previous.moves.push(...segment.moves);
      previous.moveCount = previous.moves.length;
      continue;
    }

    merged.push({
      ...segment,
      moves: [...segment.moves]
    });
  }

  return merged.map((segment, index) => ({
    ...segment,
    id: normalizeSegmentId(segment.label, index),
    moveCount: segment.moves.length
  }));
}

function shouldMergeShortSegment(segment, previous) {
  return false;
}
