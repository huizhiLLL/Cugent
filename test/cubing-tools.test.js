import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlaybackBBCode,
  createSolveReview,
  parseSegmentedSolution,
  parseTimedMoves
} from "../src/cubing-tools/index.js";

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

test("createSolveReview builds summary and assigns segments", () => {
  const review = createSolveReview({
    scramble: "R U R' U'",
    timedMoves: "U@0 R@100 F@700 B@900",
    segmentedSolution: `
U R // Cross
F B // F2L 1
`
  });

  assert.equal(review.summary.totalMoves, 4);
  assert.equal(review.summary.pauseCount, 1);
  assert.equal(review.segments.length, 2);
  assert.equal(review.segments[1].durationMs, 800);
  assert.equal(review.moves[0].segmentId, "cross");
  assert.equal(review.moves[2].segmentId, "f2l-1");
  assert.match(review.playback.bbcode, /^\[URL="/);
});
