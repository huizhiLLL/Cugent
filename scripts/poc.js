import { createSolveReview } from "../src/cubing-tools/index.js";

const sample = {
  puzzle: "333",
  source: "dctimer",
  scramble: "R U R' U'",
  timedMoves: "U'@0 R@125 L@389 L@424 U@764 U@808 B@910 U'@1218 U'@2572 U'@2793 B'@2902 U@2957 B@3018 U@3353 F'@3685 D@3734 F@3808 D'@4319",
  segmentedSolution: `
U' R L L U U B U' // Cross
U' U' B' U B U // F2L 1
F' D F D' // F2L 2
  `
};

const review = createSolveReview(sample);

console.log("CubeAgent PoC Review");
console.log("====================");
console.log(`Puzzle: ${review.puzzle}`);
console.log(`Moves: ${review.summary.totalMoves}`);
console.log(`Duration: ${review.summary.totalDurationMs}ms`);
console.log(`TPS: ${review.summary.totalTps}`);
console.log(`Pauses >= ${review.summary.pauseThresholdMs}ms: ${review.summary.pauseCount}`);
console.log("");
console.log("Segments:");
for (const segment of review.segments) {
  console.log(`- ${segment.label}: ${segment.moveCount} moves, ${segment.durationMs}ms, TPS ${segment.tps}, pauses ${segment.pauses.length}`);
}
console.log("");
console.log("Playback:");
console.log(review.playback.bbcode);
