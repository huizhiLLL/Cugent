const D_LAYER_INDICES = [4, 5, 6, 7];
const U_LAYER_INDICES = [0, 1, 2, 3];
const MIDDLE_EDGE_INDICES = [8, 9, 10, 11];

export function analyzeCFOP(review) {
  const stages = review.segments.map((segment) => analyzeSegment(segment));

  return {
    method: "CFOP",
    assumptions: [
      "当前规则假设 cross 在 D 面完成。",
      "当前规则只做阶段目标验证，不做 F2L case 识别或公式推荐。"
    ],
    stages,
    summary: {
      finalSolved: review.stateTrace.final.isSolved,
      completedGoals: stages.filter((stage) => stage.goal?.completed).length,
      totalGoals: stages.filter((stage) => stage.goal).length
    }
  };
}

function analyzeSegment(segment) {
  const stageType = classifyStage(segment.label);
  const afterPattern = segment.state.after.patternData;
  const metrics = buildMetrics(afterPattern);

  return {
    segmentId: segment.id,
    label: segment.label,
    stageType,
    moveCount: segment.moveCount,
    durationMs: segment.durationMs,
    tps: segment.tps,
    pauses: segment.pauses.length,
    metrics,
    goal: buildGoal(stageType, afterPattern, metrics, segment.state.after.isSolved)
  };
}

function classifyStage(label) {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("cross")) {
    return "cross";
  }
  if (normalized.includes("f2l")) {
    return "f2l";
  }
  if (normalized.includes("oll")) {
    return "oll";
  }
  if (normalized.includes("pll")) {
    return "pll";
  }
  return "unknown";
}

function buildMetrics(patternData) {
  return {
    solvedCrossEdges: countSolvedPieces(patternData, "EDGES", D_LAYER_INDICES),
    solvedDLayerCorners: countSolvedPieces(patternData, "CORNERS", D_LAYER_INDICES),
    solvedMiddleEdges: countSolvedPieces(patternData, "EDGES", MIDDLE_EDGE_INDICES),
    orientedULayerEdges: countOrientedPieces(patternData, "EDGES", U_LAYER_INDICES),
    orientedULayerCorners: countOrientedPieces(patternData, "CORNERS", U_LAYER_INDICES)
  };
}

function buildGoal(stageType, patternData, metrics, isSolved) {
  if (stageType === "cross") {
    return {
      type: "D_CROSS_SOLVED",
      completed: metrics.solvedCrossEdges === 4,
      evidence: `${metrics.solvedCrossEdges}/4 D-layer edges solved`
    };
  }

  if (stageType === "f2l") {
    const solvedDLayerCorners = metrics.solvedDLayerCorners;
    const solvedMiddleEdges = metrics.solvedMiddleEdges;
    return {
      type: "F2L_PROGRESS",
      completed: solvedDLayerCorners === 4 && solvedMiddleEdges === 4,
      evidence: `${solvedDLayerCorners}/4 D-layer corners solved, ${solvedMiddleEdges}/4 middle edges solved`
    };
  }

  if (stageType === "oll") {
    const orientedEdges = metrics.orientedULayerEdges;
    const orientedCorners = metrics.orientedULayerCorners;
    return {
      type: "U_LAYER_ORIENTED",
      completed: orientedEdges === 4 && orientedCorners === 4,
      evidence: `${orientedEdges}/4 U-layer edges oriented, ${orientedCorners}/4 U-layer corners oriented`
    };
  }

  if (stageType === "pll") {
    return {
      type: "SOLVED",
      completed: isSolved,
      evidence: isSolved ? "Cube is solved after PLL" : "Cube is not solved after PLL"
    };
  }

  return {
    type: "UNKNOWN_STAGE",
    completed: false,
    evidence: "No CFOP goal rule for this segment label"
  };
}

function countSolvedPieces(patternData, orbitName, indices) {
  const orbit = patternData[orbitName];
  return indices.filter((index) => orbit.pieces[index] === index && orbit.orientation[index] === 0).length;
}

function countOrientedPieces(patternData, orbitName, indices) {
  const orbit = patternData[orbitName];
  return indices.filter((index) => orbit.orientation[index] === 0).length;
}
