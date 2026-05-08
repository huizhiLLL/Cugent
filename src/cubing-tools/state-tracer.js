import { Alg } from "cubing/alg";
import { cube3x3x3 } from "cubing/puzzles";
import { getCf4opProgressByOrientation } from "./cfop-progress.js";

export async function traceCubeState({ scramble, solution, includeTimeline = true }) {
  assertAlg("scramble", scramble);
  assertAlg("solution", solution);

  const kpuzzle = await cube3x3x3.kpuzzle();
  const solvedPattern = kpuzzle.defaultPattern();
  const scrambleAlg = new Alg(scramble);
  const solutionAlg = new Alg(solution);
  const afterScramble = solvedPattern.applyAlg(scrambleAlg);

  let currentPattern = afterScramble;
  const timeline = [];

  if (includeTimeline) {
    let index = 0;
    for (const move of solutionAlg.experimentalLeafMoves()) {
      currentPattern = currentPattern.applyMove(move);
      timeline.push({
        index,
        move: move.toString(),
        ...patternSnapshot(currentPattern)
      });
      index += 1;
    }
  } else {
    currentPattern = afterScramble.applyAlg(solutionAlg);
  }

  return {
    puzzle: "333",
    scramble: scrambleAlg.toString(),
    solution: solutionAlg.toString(),
    afterScramble: {
      ...patternSnapshot(afterScramble)
    },
    final: {
      ...patternSnapshot(currentPattern),
      matchesSolvedPattern: currentPattern.isIdentical(solvedPattern)
    },
    timeline
  };
}

export function invertAlg(alg) {
  assertAlg("alg", alg);
  return new Alg(alg).invert().toString();
}

function assertAlg(name, alg) {
  if (!alg || !String(alg).trim()) {
    throw new Error(`${name} 不能为空`);
  }

  try {
    new Alg(alg);
  } catch (error) {
    throw new Error(`${name} 解析失败：${error.message}`);
  }
}

function patternSnapshot(pattern) {
  const patternData = pattern.toJSON().patternData;
  const cf4opProgressByOrientation = getCf4opProgressByOrientation(pattern);
  return {
    patternData,
    cf4opProgress: Math.min(...cf4opProgressByOrientation),
    cf4opProgressByOrientation,
    stateHash: JSON.stringify(patternData),
    isSolved: pattern.experimentalIsSolved({})
  };
}
