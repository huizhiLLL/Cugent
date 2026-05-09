import { Alg } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { cube3x3x3 } from "cubing/puzzles";
import { isMaskSolved, patternDataToFacelet, toEqus } from "./cfop-progress.js";

const crossMask = toEqus("----U--------R--R-----F--F--D-DDD-D-----L--L-----B--B-");
const f2l1Mask = toEqus("----U-------RR-RR-----FF-FF-DDDDD-D-----L--L-----B--B-");
const f2l2Mask = toEqus("----U--------R--R----FF-FF-DD-DDD-D-----LL-LL----B--B-");
const f2l3Mask = toEqus("----U--------RR-RR----F--F--D-DDD-DD----L--L----BB-BB-");
const f2l4Mask = toEqus("----U--------R--R-----F--F--D-DDDDD----LL-LL-----BB-BB");
const ollMask = toEqus("UUUUUUUUU---RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB");
const solvedMask = toEqus("UUUUUUUUULLLLLLLLLFFFFFFFFFRRRRRRRRRBBBBBBBBBDDDDDDDDD");
const F2L_MASKS = [f2l1Mask, f2l2Mask, f2l3Mask, f2l4Mask];
const ORIENTATION_ALGS = [
  "",
  "y",
  "y2",
  "y'",
  "x",
  "x y",
  "x y2",
  "x y'",
  "x2",
  "x2 y",
  "x2 y2",
  "x2 y'",
  "x'",
  "x' y",
  "x' y2",
  "x' y'",
  "z",
  "z y",
  "z y2",
  "z y'",
  "z'",
  "z' y",
  "z' y2",
  "z' y'"
].map((alg) => new Alg(alg));

export async function analyzeCFOP(review) {
  const orientationIndex = review.segmentation.orientationIndex;
  const stages = await Promise.all(review.segments.map((segment) => analyzeSegment(segment, orientationIndex)));

  return {
    method: "CFOP",
    assumptions: [
      orientationIndex == null
        ? "当前规则按默认朝向验证阶段目标。"
        : `当前规则按推断选中的朝向 ${orientationIndex} 验证阶段目标。`,
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

async function analyzeSegment(segment, orientationIndex) {
  const stageType = classifyStage(segment.label);
  const afterPattern = await orientPatternData(segment.state.after.patternData, orientationIndex);
  const metrics = buildMetrics(afterPattern);

  return {
    segmentId: segment.id,
    label: segment.label,
    stageType,
    recognition: segment.recognition ?? null,
    moveCount: segment.moveCount,
    effectiveMoveCount: segment.effectiveMoveCount,
    durationMs: segment.durationMs,
    tps: segment.tps,
    pauses: segment.pauses.length,
    metrics,
    goal: buildGoal(stageType, segment.label, metrics, segment.state.after.isSolved)
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
  const facelet = patternDataToFacelet(patternData);

  return {
    crossSolved: isMaskSolved(facelet, crossMask),
    solvedF2LPairs: F2L_MASKS.filter((mask) => isMaskSolved(facelet, mask)).length,
    ollSolved: isMaskSolved(facelet, ollMask),
    pllSolved: isMaskSolved(facelet, solvedMask)
  };
}

function buildGoal(stageType, label, metrics, isSolved) {
  if (stageType === "cross") {
    return {
      type: "D_CROSS_SOLVED",
      completed: metrics.crossSolved,
      evidence: metrics.crossSolved
        ? "Cross target solved under current analysis orientation"
        : "Cross target not solved under current analysis orientation"
    };
  }

  if (stageType === "f2l") {
    const expectedPairs = getExpectedSolvedPairs(label);
    return {
      type: "F2L_PROGRESS",
      completed: metrics.crossSolved && metrics.solvedF2LPairs >= expectedPairs,
      evidence: `${metrics.solvedF2LPairs}/4 F2L pairs solved, expected at least ${expectedPairs}/4`
    };
  }

  if (stageType === "oll") {
    return {
      type: "U_LAYER_ORIENTED",
      completed: metrics.ollSolved,
      evidence: metrics.ollSolved
        ? "U-layer orientation target solved under current analysis orientation"
        : "U-layer orientation target not solved under current analysis orientation"
    };
  }

  if (stageType === "pll") {
    return {
      type: "SOLVED",
      completed: isSolved || metrics.pllSolved,
      evidence: isSolved || metrics.pllSolved ? "Cube is solved after PLL" : "Cube is not solved after PLL"
    };
  }

  return {
    type: "UNKNOWN_STAGE",
    completed: false,
    evidence: "No CFOP goal rule for this segment label"
  };
}

function getExpectedSolvedPairs(label) {
  const match = label.match(/f2l\s*(\d)/i);
  const expectedPairs = Number(match?.[1] ?? 4);
  return Math.max(1, Math.min(4, expectedPairs));
}

async function orientPatternData(patternData, orientationIndex) {
  if (orientationIndex == null) {
    return patternData;
  }

  const orientationAlg = ORIENTATION_ALGS[orientationIndex];
  if (!orientationAlg || !orientationAlg.toString()) {
    return patternData;
  }

  const kpuzzle = await cube3x3x3.kpuzzle();
  const pattern = new KPattern(kpuzzle, patternData);
  return pattern.applyAlg(orientationAlg).toJSON().patternData;
}
