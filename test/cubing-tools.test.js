import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackBBCode,
  createSolveReview,
  invertAlg,
  parseSegmentedSolution,
  parseTimedMoves,
  generateCoachSuggestions,
  searchAlgorithms,
  traceCubeState
} from "../src/cubing-tools/index.js";
import { composeResponse, detectIntent, runAgentTurn } from "../src/agent-runtime/index.js";

test("parseTimedMoves parses cstimer style review field", () => {
  const moves = parseTimedMoves(`["U'@0 R@125 L2@389","333"]`);

  assert.equal(moves.length, 3);
  assert.deepEqual(moves.map((move) => move.move), ["U'", "R", "L2"]);
  assert.equal(moves[1].deltaMs, 125);
  assert.equal(moves[2].deltaMs, 264);
});

test("parseTimedMoves rejects decreasing timestamps", () => {
  assert.throws(() => parseTimedMoves("U@20 R@10"), /timestamp 必须递增/);
});

test("parseSegmentedSolution parses CFOP labels", () => {
  const segments = parseSegmentedSolution(`
U F U F // Cross
R U R' // F2L 1
`);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].id, "cross");
  assert.equal(segments[1].label, "F2L 1");
  assert.deepEqual(segments[1].moves, ["R", "U", "R'"]);
});

test("buildPlaybackBBCode generates embeddable alg.cubing.net link", () => {
  const bbcode = buildPlaybackBBCode({ setup: "R", alg: "R'", label: "R'" });

  assert.equal(bbcode, `[URL="https://alg.cubing.net/?setup=R&alg=R-&view=playback"]R'[/URL]`);
});

test("traceCubeState validates scramble plus inverse solution", async () => {
  const scramble = "R U R' U'";
  const solution = invertAlg(scramble);
  const trace = await traceCubeState({ scramble, solution });

  assert.equal(solution, "U R U' R'");
  assert.equal(trace.afterScramble.isSolved, false);
  assert.equal(trace.final.isSolved, true);
  assert.equal(trace.timeline.length, 4);
});

test("createSolveReview builds summary and assigns segments", async () => {
  const scramble = "R U R' U'";
  const solution = invertAlg(scramble);
  const review = await createSolveReview({
    scramble,
    timedMoves: "U@0 R@100 U'@700 R'@900",
    segmentedSolution: `
U R // Cross
U' R' // F2L 1
`
  });

  assert.equal(review.summary.totalMoves, 4);
  assert.equal(review.summary.pauseCount, 1);
  assert.equal(review.validation.ok, true);
  assert.equal(review.segments.length, 2);
  assert.equal(review.segments[1].durationMs, 800);
  assert.equal(review.moves[0].segmentId, "cross");
  assert.equal(review.moves[2].segmentId, "f2l-1");
  assert.equal(review.stateTrace.final.isSolved, true);
  assert.equal(review.segments[0].state.before.isSolved, false);
  assert.equal(review.segments[1].state.after.isSolved, true);
  assert.equal(review.segments[0].state.changed, true);
  assert.equal(review.cfopAnalysis.method, "CFOP");
  assert.equal(review.cfopAnalysis.stages[0].stageType, "cross");
  assert.equal(review.cfopAnalysis.stages[1].stageType, "f2l");
  assert.equal(review.cfopAnalysis.stages[1].goal.completed, true);
  assert.ok(review.coachSuggestions.suggestions.length >= 1);
  assert.match(review.playback.bbcode, /^\[URL="/);
});

test("createSolveReview reports segment alignment warnings", async () => {
  const review = await createSolveReview({
    scramble: "R",
    timedMoves: "R'@0",
    segmentedSolution: "U // Cross"
  });

  assert.equal(review.validation.ok, false);
  assert.equal(review.validation.warnings[0].code, "SEGMENT_MOVE_MISMATCH");
});

test("createSolveReview analyzes OLL and PLL goals", async () => {
  const review = await createSolveReview({
    scramble: "R U",
    timedMoves: "U'@0 R'@100",
    segmentedSolution: `
U' // OLL
R' // PLL
`
  });

  assert.equal(review.cfopAnalysis.stages[0].stageType, "oll");
  assert.equal(review.cfopAnalysis.stages[0].goal.type, "U_LAYER_ORIENTED");
  assert.equal(review.cfopAnalysis.stages[1].stageType, "pll");
  assert.equal(review.cfopAnalysis.stages[1].goal.completed, true);
  assert.equal(review.cfopAnalysis.summary.finalSolved, true);
});

test("searchAlgorithms filters by set, caseId and tags", () => {
  const result = searchAlgorithms({ set: "OLL", caseId: "27", tags: ["right-hand"] });

  assert.equal(result.total, 1);
  assert.equal(result.results[0].id, "oll-27-01");
  assert.match(result.results[0].playback.bbcode, /^\[URL="/);
});

test("searchAlgorithms ranks no-rotation low-slice candidates first", () => {
  const result = searchAlgorithms({ set: "F2L", caseId: "basic-insert", tags: ["beginner-friendly"] });

  assert.equal(result.total, 2);
  assert.equal(result.results[0].metrics.hasRotation, false);
  assert.equal(result.results[0].metrics.sliceMoves, 0);
});

test("generateCoachSuggestions creates evidence-based suggestions", async () => {
  const review = await createSolveReview({
    scramble: "R U R' U'",
    timedMoves: "U@0 R@100 U'@900 R'@1100",
    segmentedSolution: `
U R // Cross
U' R' // F2L 1
`
  });

  const suggestions = generateCoachSuggestions(review).suggestions;

  assert.ok(suggestions.some((suggestion) => suggestion.type === "stage-goal"));
  assert.ok(suggestions.some((suggestion) => suggestion.type === "pause"));
  assert.ok(suggestions.some((suggestion) => suggestion.type === "algorithm-candidates"));
});

test("detectIntent detects solve imports", () => {
  const intent = detectIntent(`
scramble: R U R' U'
timedMoves: U@0 R@100
segmentedSolution:
U R // Cross
`);

  assert.equal(intent.type, "solve-import");
  assert.equal(intent.params.scramble, "R U R' U'");
});

test("detectIntent accepts common copied solve field aliases", () => {
  const intent = detectIntent(`
Scramble: R U R' U'
review: U@0 R@100 U'@200 R'@300
solution:
U R // Cross
U' R' // F2L 1
`);

  assert.equal(intent.type, "solve-import");
  assert.equal(intent.params.scramble, "R U R' U'");
  assert.match(intent.params.timedMoves, /U@0 R@100/);
  assert.match(intent.params.segmentedSolution, /F2L 1/);
});

test("runAgentTurn imports solve and answers local followup", async () => {
  const scramble = "R U R' U'";
  const solution = invertAlg(scramble);
  const solveTurn = await runAgentTurn(`
scramble: ${scramble}
timedMoves: ${solution.split(" ").map((move, index) => `${move}@${index * 100}`).join(" ")}
segmentedSolution:
U R // Cross
U' R' // F2L 1
`);

  assert.equal(solveTurn.intent.type, "solve-import");
  assert.equal(solveTurn.toolResult.type, "solve-review");
  assert.equal(solveTurn.response.kind, "solve-review");
  assert.match(solveTurn.response.text, /已经导入/);

  const followupTurn = await runAgentTurn("F2L 1 这里怎么看？", solveTurn.contextPatch);

  assert.equal(followupTurn.intent.type, "local-followup");
  assert.equal(followupTurn.toolResult.type, "segment-inspection");
  assert.equal(followupTurn.toolResult.segment.label, "F2L 1");
  assert.equal(followupTurn.response.kind, "segment-inspection");
});

test("runAgentTurn returns structured solve import errors", async () => {
  const turn = await runAgentTurn(`
scramble: R U
timedMoves: R@100 U@50
`);

  assert.equal(turn.toolResult.type, "error");
  assert.equal(turn.toolResult.code, "TIMESTAMP_ORDER");
  assert.equal(turn.contextPatch.lastImportError.code, "TIMESTAMP_ORDER");
  assert.equal(turn.response.kind, "error");
  assert.match(turn.response.evidence[0], /问题 token/);
});

test("runAgentTurn reports missing scramble from structured input", async () => {
  const turn = await runAgentTurn(`
scramble:
timedMoves: R@0 U@100
segmentedSolution:
R U // Cross
`);

  assert.equal(turn.toolResult.type, "error");
  assert.equal(turn.toolResult.code, "MISSING_SCRAMBLE");
  assert.equal(turn.response.error.code, "MISSING_SCRAMBLE");
});

test("runAgentTurn uses selected segment for vague followup", async () => {
  const scramble = "R U R' U'";
  const solution = invertAlg(scramble);
  const solveTurn = await runAgentTurn(`
scramble: ${scramble}
timedMoves: ${solution.split(" ").map((move, index) => `${move}@${index * 100}`).join(" ")}
segmentedSolution:
U R // Cross
U' R' // F2L 1
`);
  const context = {
    ...solveTurn.contextPatch,
    selectedSegmentId: "cross"
  };
  const followupTurn = await runAgentTurn("这里为什么要看？", context);

  assert.equal(followupTurn.intent.type, "local-followup");
  assert.equal(followupTurn.toolResult.segment.label, "Cross");
  assert.equal(followupTurn.contextPatch.selectedSegmentId, "cross");
});

test("runAgentTurn handles algorithm queries", async () => {
  const turn = await runAgentTurn("给我一个右手 no-rotation 的 OLL 27 公式");

  assert.equal(turn.intent.type, "algorithm-query");
  assert.equal(turn.toolResult.type, "algorithm-search");
  assert.equal(turn.toolResult.result.total, 1);
  assert.equal(turn.response.kind, "algorithm-search");
  assert.equal(turn.response.candidates.length, 1);
});

test("composeResponse handles chat fallback", () => {
  const response = composeResponse({
    toolResult: {
      type: "chat",
      message: "未命中特定魔方工具，交给普通聊天模型处理。"
    }
  });

  assert.equal(response.kind, "chat-fallback");
});
