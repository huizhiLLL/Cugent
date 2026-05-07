import { createSolveReview, invertAlg, searchAlgorithms } from "../src/cubing-tools/index.js";

const scramble = "R U R' U'";
const solution = invertAlg(scramble);

const sample = {
  puzzle: "333",
  source: "dctimer",
  scramble,
  timedMoves: solution.split(" ").map((move, index) => `${move}@${index * 250}`).join(" "),
  segmentedSolution: `
${solution.split(" ").slice(0, 2).join(" ")} // Cross
${solution.split(" ").slice(2).join(" ")} // F2L 1
  `
};

const review = await createSolveReview(sample);

console.log("CubeAgent PoC Review");
console.log("====================");
console.log(`Puzzle: ${review.puzzle}`);
console.log(`Moves: ${review.summary.totalMoves}`);
console.log(`Duration: ${review.summary.totalDurationMs}ms`);
console.log(`TPS: ${review.summary.totalTps}`);
console.log(`Pauses >= ${review.summary.pauseThresholdMs}ms: ${review.summary.pauseCount}`);
console.log(`Solved after solution: ${review.stateTrace.final.isSolved}`);
console.log(`Validation: ${review.validation.ok ? "ok" : "warnings"}`);
console.log("");
console.log("Segments:");
for (const segment of review.segments) {
  const stage = review.cfopAnalysis.stages.find((item) => item.segmentId === segment.id);
  console.log(`- ${segment.label}: ${segment.moveCount} moves, ${segment.durationMs}ms, TPS ${segment.tps}, pauses ${segment.pauses.length}, solvedAfter=${segment.state.after.isSolved}, goal=${stage.goal.completed}`);
  console.log(`  ${stage.goal.evidence}`);
}
console.log("");
console.log("Playback:");
console.log(review.playback.bbcode);

console.log("");
console.log("Algorithm search:");
const ollCandidates = searchAlgorithms({ set: "OLL", caseId: "27", tags: ["right-hand"] });
for (const candidate of ollCandidates.results) {
  console.log(`- ${candidate.name}: ${candidate.alg}`);
  console.log(`  ${candidate.playback.bbcode}`);
}

console.log("");
console.log("Coach suggestions:");
for (const suggestion of review.coachSuggestions.suggestions) {
  console.log(`- [${suggestion.priority}] ${suggestion.title}`);
  for (const evidence of suggestion.evidence) {
    console.log(`  ${evidence}`);
  }
}
