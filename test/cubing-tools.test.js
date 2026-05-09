import assert from "node:assert/strict";
import test from "node:test";
import { Alg } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { cube3x3x3 } from "cubing/puzzles";
import {
  buildPlaybackBBCode,
  calculateEffectiveMoveCount,
  createSolveReview,
  identifyOllCaseFromPatternData,
  identifyPllCaseFromPatternData,
  invertAlg,
  inferCf4opSegments,
  listRecognizableOllCases,
  listRecognizablePllCases,
  parseSegmentedSolution,
  parseTimedMoves,
  generateCoachSuggestions,
  searchAlgorithms,
  simplifyAlgMoves,
  traceCubeState
} from "../src/cubing-tools/index.js";
import { buildChatCompletionMessages, buildPromptMessages, composeResponse, detectIntent, runAgentTurn } from "../src/agent-runtime/index.js";
import { buildEditedConversation, resolveEditedUserMessageIndex } from "../src/web/chat-editing.js";
import { createEmptyConversation, deriveConversationTitle, sanitizeChatState } from "../src/web/chat-storage.js";
import { defaultLlmSettings, sanitizeLlmSettings } from "../src/web/llm-settings.js";
import { extractChatCompletionText, joinChatCompletionsUrl, LlmClientError } from "../src/agent-runtime/index.js";

test("parseTimedMoves parses cstimer style review field", () => {
  const moves = parseTimedMoves(`["U'@0 R@125 L2@389","333"]`);

  assert.equal(moves.length, 3);
  assert.deepEqual(moves.map((move) => move.move), ["U'", "R", "L2"]);
  assert.equal(moves[1].deltaMs, 125);
  assert.equal(moves[2].deltaMs, 264);
});

test("resolveEditedUserMessageIndex prefers sourceId to keep earlier assistant replies", () => {
  const messages = [
    { id: "u1", role: "user", text: "第一条" },
    { id: "a1", role: "assistant", text: "第一条回复" },
    { id: "u2", role: "user", text: "第二条" },
    { id: "a2", role: "assistant", text: "第二条回复" }
  ];

  const index = resolveEditedUserMessageIndex(messages, {
    parentId: "a1",
    sourceId: "u2"
  });

  assert.equal(index, 2);
});

test("buildEditedConversation preserves prior assistant message when editing latest user turn", () => {
  const conversation = {
    id: "conv-1",
    title: "第一条",
    messages: [
      { id: "u1", role: "user", text: "第一条" },
      { id: "a1", role: "assistant", text: "第一条回复" },
      { id: "u2", role: "user", text: "第二条" },
      { id: "a2", role: "assistant", text: "第二条回复" }
    ]
  };

  const nextConversation = buildEditedConversation(
    conversation,
    { parentId: "a1", sourceId: "u2" },
    "第二条-编辑",
    {
      createUserMessage: (role, text, extra = {}) => ({ role, text, ...extra }),
      deriveConversationTitle
    }
  );

  assert.deepEqual(
    nextConversation.messages.map((item) => `${item.role}:${item.id}:${item.text}`),
    [
      "user:u1:第一条",
      "assistant:a1:第一条回复",
      "user:u2:第二条-编辑"
    ]
  );
});

test("parseTimedMoves rejects decreasing timestamps", () => {
  assert.throws(() => parseTimedMoves("U@20 R@10"), /timestamp 必须递增/);
});

test("calculateEffectiveMoveCount merges repeated turns and cancels inverse turns", () => {
  assert.equal(calculateEffectiveMoveCount("U U"), 1);
  assert.equal(calculateEffectiveMoveCount("U U'"), 0);
  assert.equal(calculateEffectiveMoveCount("U U U"), 1);
  assert.equal(calculateEffectiveMoveCount("R2 R2"), 0);
  assert.deepEqual(simplifyAlgMoves("U U R R' U'"), ["U"]);
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
  assert.equal(review.segments[1].recognition?.pll?.matched, true);
  assert.equal(review.segments[1].recognition?.pll?.caseId, "Solved");
  assert.equal(review.cfopAnalysis.summary.finalSolved, true);
});

test("inferCf4opSegments splits segments from monotonic cf4op progress", () => {
  const moves = ["D", "R", "U", "L", "F", "B", "U'"].map((move, index) => ({
    index,
    move,
    timestampMs: index * 120,
    deltaMs: index === 0 ? 0 : 120,
    segmentId: null
  }));
  const orientationTrace = [7, 6, 5, 4, 3, 2, 1, 0];
  const stateTrace = {
    final: { isSolved: true },
    afterScramble: {
      cf4opProgress: orientationTrace[0],
      cf4opProgressByOrientation: [orientationTrace[0]]
    },
    timeline: orientationTrace.slice(1).map((progress) => ({
      cf4opProgress: progress,
      cf4opProgressByOrientation: [progress]
    }))
  };

  const inferred = inferCf4opSegments({ moves, stateTrace });

  assert.equal(inferred.orientationIndex, null);
  assert.deepEqual(
    inferred.progressTrace.map((entry) => entry.progress),
    [7, 6, 5, 4, 3, 2, 1, 0]
  );
  assert.deepEqual(
    inferred.segments.map((segment) => segment.label),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"]
  );
  assert.deepEqual(
    inferred.segments.map((segment) => segment.moveCount),
    [1, 1, 1, 1, 1, 1, 1]
  );
});

test("inferCf4opSegments ignores progress rebounds after earlier breakthroughs", () => {
  const moves = ["R", "U", "R'", "U'"].map((move, index) => ({
    index,
    move,
    timestampMs: index * 100,
    deltaMs: index === 0 ? 0 : 100,
    segmentId: null
  }));
  const stateTrace = {
    final: { isSolved: false },
    afterScramble: {
      cf4opProgress: 7,
      cf4opProgressByOrientation: [7, 3]
    },
    timeline: [
      { cf4opProgress: 7, cf4opProgressByOrientation: [7, 7] },
      { cf4opProgress: 6, cf4opProgressByOrientation: [6, 7] },
      { cf4opProgress: 7, cf4opProgressByOrientation: [5, 7] },
      { cf4opProgress: 5, cf4opProgressByOrientation: [5, 0] }
    ]
  };

  const inferred = inferCf4opSegments({ moves, stateTrace });

  assert.equal(inferred.orientationIndex, 1);
  assert.deepEqual(
    inferred.progressTrace.map((entry) => entry.progress),
    [3, 3, 3, 3, 0]
  );
  assert.deepEqual(
    inferred.segments.map((segment) => segment.label),
    ["F2L 4"]
  );
});

test("inferCf4opSegments drops zero-move noise segments during post process", () => {
  const moves = ["R", "U", "R'"].map((move, index) => ({
    index,
    move,
    timestampMs: index * 100,
    deltaMs: index === 0 ? 0 : 100,
    segmentId: null
  }));
  const stateTrace = {
    final: { isSolved: true },
    afterScramble: { cf4opProgress: 7 },
    timeline: [
      { cf4opProgress: 6 },
      { cf4opProgress: 5 },
      { cf4opProgress: 0 }
    ]
  };

  const inferred = inferCf4opSegments({ moves, stateTrace });

  assert.deepEqual(
    inferred.segments.map((segment) => ({ label: segment.label, moveCount: segment.moveCount })),
    [
      { label: "Cross", moveCount: 1 },
      { label: "F2L 1", moveCount: 1 },
      { label: "F2L 2", moveCount: 1 }
    ]
  );
});

test("createSolveReview chooses a stable orientation trace for real no-segment solves", async () => {
  const review = await createSolveReview({
    scramble: "B' R' U2 L2 F U2 L2 B2 F' D2 F R2 B D R U2 L F2 R' U",
    timedMoves: `["U'@0 F'@136 U'@265 F'@448 F'@504 U'@729 F@1475 D@1582 F'@1792 D@2166 R'@2233 D'@2294 R@2367 R@2423 D'@2483 R'@2572 D@2621 R@2674 D'@2720 R'@3083 R@3360 D'@3409 R'@3475 L@3628 D@3739 D@3788 L'@3850 D@4356 L'@4444 D@4505 L@4563 D'@5008 R@5112 D'@5170 R'@5237 D@5294 R@5343 D'@5383 R'@5474 D@5537 D@5590 R@5641 D'@5694 R'@5759 D@6236 R@6327 D@6434 R'@6506 D'@6614 L@6669 R'@6803 B@6852 R@6913 B'@6958 L'@7049 R@7544 D'@7605 R'@7685 D'@7778 R@7896 D@8146 R@8232 U@8283 R'@8380 D'@8430 R@8495 U'@8544 R'@8664 D@8737 D@8775 R'@8818 D'@8888 D'@8916","333"]`
  });

  assert.equal(review.segmentation.orientationIndex, 8);
  assert.deepEqual(
    review.segmentation.progressTrace.map((entry) => entry.progress),
    [
      7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5,
      5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3,
      3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0
    ]
  );
  assert.deepEqual(
    review.segments.map((segment) => ({ label: segment.label, moveCount: segment.moveCount })),
    [
      { label: "Cross", moveCount: 6 },
      { label: "F2L 1", moveCount: 7 },
      { label: "F2L 2", moveCount: 14 },
      { label: "F2L 3", moveCount: 4 },
      { label: "F2L 4", moveCount: 13 },
      { label: "OLL", moveCount: 11 },
      { label: "PLL", moveCount: 18 }
    ]
  );
  assert.deepEqual(
    review.cfopAnalysis.stages.map((stage) => ({ label: stage.label, completed: stage.goal.completed, evidence: stage.goal.evidence })),
    [
      { label: "Cross", completed: true, evidence: "Cross target solved under current analysis orientation" },
      { label: "F2L 1", completed: true, evidence: "1/4 F2L pairs solved, expected at least 1/4" },
      { label: "F2L 2", completed: true, evidence: "2/4 F2L pairs solved, expected at least 2/4" },
      { label: "F2L 3", completed: true, evidence: "3/4 F2L pairs solved, expected at least 3/4" },
      { label: "F2L 4", completed: true, evidence: "4/4 F2L pairs solved, expected at least 4/4" },
      { label: "OLL", completed: true, evidence: "U-layer orientation target solved under current analysis orientation" },
      { label: "PLL", completed: true, evidence: "Cube is solved after PLL" }
    ]
  );
  assert.match(review.segments.find((segment) => segment.label === "OLL").playback.bbcode, /setup=.*_x2_y&alg=y-_x2-/);
  assert.match(review.segments.find((segment) => segment.label === "PLL").playback.bbcode, /setup=.*_x2&alg=x2-_/);
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

test("listRecognizableOllCases exposes cstimer-compatible OLL registry", () => {
  const ollCases = listRecognizableOllCases();

  assert.equal(ollCases.length, 57);
  assert.equal(ollCases[20].caseId, "21");
  assert.equal(ollCases[26].caseId, "27");
});

test("identifyOllCaseFromPatternData identifies OLL 27", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const pattern = solved.applyAlg(new Alg("R U R' U R U2 R'").invert());

  const recognized = await identifyOllCaseFromPatternData(pattern.toJSON().patternData);

  assert.equal(recognized.matched, true);
  assert.equal(recognized.stageVerified, true);
  assert.equal(recognized.caseId, "27");
});

test("identifyOllCaseFromPatternData identifies OLL 21", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const pattern = solved.applyAlg(new Alg("R U R' U R U' R' U R U2 R'").invert());

  const recognized = await identifyOllCaseFromPatternData(pattern.toJSON().patternData);

  assert.equal(recognized.matched, true);
  assert.equal(recognized.stageVerified, true);
  assert.equal(recognized.caseId, "21");
});

test("identifyOllCaseFromPatternData rejects non-OLL states", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const nonOllPattern = new KPattern(kpuzzle, (kpuzzle.defaultPattern().applyAlg(new Alg("R U"))).toJSON().patternData);

  const recognized = await identifyOllCaseFromPatternData(nonOllPattern.toJSON().patternData);

  assert.equal(recognized.matched, false);
  assert.equal(recognized.stageVerified, false);
  assert.equal(recognized.caseId, null);
});

test("listRecognizablePllCases exposes cstimer-compatible PLL registry", () => {
  const pllCases = listRecognizablePllCases();

  assert.equal(pllCases.length, 22);
  assert.equal(pllCases[18].caseId, "T");
  assert.equal(pllCases[1].caseId, "Ua");
});

test("identifyPllCaseFromPatternData identifies T perm", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const pattern = solved.applyAlg(new Alg("R U R' U' R' F R2 U' R' U' R U R' F'").invert());

  const recognized = await identifyPllCaseFromPatternData(pattern.toJSON().patternData);

  assert.equal(recognized.matched, true);
  assert.equal(recognized.stageVerified, true);
  assert.equal(recognized.caseId, "T");
  assert.equal(recognized.name, "T Perm");
});

test("identifyPllCaseFromPatternData identifies Ua perm", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const pattern = solved.applyAlg(new Alg("R U' R U R U R U' R' U' R2").invert());

  const recognized = await identifyPllCaseFromPatternData(pattern.toJSON().patternData);

  assert.equal(recognized.matched, true);
  assert.equal(recognized.stageVerified, true);
  assert.equal(recognized.caseId, "Ua");
  assert.equal(recognized.name, "Ua Perm");
});

test("identifyPllCaseFromPatternData rejects non-PLL states", async () => {
  const kpuzzle = await cube3x3x3.kpuzzle();
  const nonPllPattern = new KPattern(kpuzzle, (kpuzzle.defaultPattern().applyAlg(new Alg("R U"))).toJSON().patternData);

  const recognized = await identifyPllCaseFromPatternData(nonPllPattern.toJSON().patternData);

  assert.equal(recognized.matched, false);
  assert.equal(recognized.stageVerified, false);
  assert.equal(recognized.caseId, null);
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
  assert.ok(!suggestions.some((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "f2l"));
});

test("generateCoachSuggestions includes pause window evidence", async () => {
  const review = await createSolveReview({
    scramble: "R U R' U'",
    timedMoves: "U@0 R@100 U'@900 R'@1100",
    segmentedSolution: `
U R // Cross
U' R' // F2L 1
`
  });

  const pauseSuggestion = review.coachSuggestions.suggestions.find((suggestion) => suggestion.type === "pause");

  assert.ok(pauseSuggestion);
  assert.ok(pauseSuggestion.evidence.some((line) => /停顿窗口：/.test(line)));
  assert.ok(pauseSuggestion.evidence.some((line) => /状态摘要：.*底层角已归位/.test(line)));
});

test("generateCoachSuggestions recommends recognized PLL algorithms when actual effective move count is much longer", () => {
  const review = {
    scramble: "R U",
    summary: { pauseThresholdMs: 500 },
    validation: { warnings: [] },
    segments: [{
      id: "pll",
      label: "PLL",
      pauses: [],
      pauseWindows: [],
      setupAlg: "R U",
      displaySetupAlg: "x2 R U"
    }],
    cfopAnalysis: {
      stages: [{
        segmentId: "pll",
        label: "PLL",
        stageType: "pll",
        pauses: 0,
        moveCount: 18,
        effectiveMoveCount: 18,
        goal: {
          completed: true,
          evidence: "Cube is solved after PLL"
        },
        recognition: {
          pll: {
            matched: true,
            caseId: "T"
          }
        }
      }]
    }
  };

  const pllSuggestion = generateCoachSuggestions(review).suggestions.find((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "pll");

  assert.ok(pllSuggestion);
  assert.equal(pllSuggestion.candidates.length, 1);
  assert.equal(pllSuggestion.candidates[0].caseId, "T");
  assert.match(pllSuggestion.candidates[0].playback.bbcode, /setup=x2_R_U/);
  assert.ok(pllSuggestion.evidence.some((line) => /当前实际使用约 18 步/.test(line)));
});

test("generateCoachSuggestions relaxes no-rotation filter for recognized PLL case fallback", () => {
  const review = {
    scramble: "R U",
    summary: { pauseThresholdMs: 500 },
    validation: { warnings: [] },
    segments: [{
      id: "pll",
      label: "PLL",
      pauses: [],
      pauseWindows: [],
      setupAlg: "R U"
    }],
    cfopAnalysis: {
      stages: [{
        segmentId: "pll",
        label: "PLL",
        stageType: "pll",
        pauses: 0,
        moveCount: 16,
        effectiveMoveCount: 16,
        goal: {
          completed: true,
          evidence: "Cube is solved after PLL"
        },
        recognition: {
          pll: {
            matched: true,
            caseId: "Aa"
          }
        }
      }]
    }
  };

  const pllSuggestion = generateCoachSuggestions(review).suggestions.find((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "pll");

  assert.ok(pllSuggestion);
  assert.equal(pllSuggestion.candidates.length, 1);
  assert.equal(pllSuggestion.candidates[0].caseId, "Aa");
});

test("generateCoachSuggestions uses recognized OLL caseId in algorithm candidates", () => {
  const review = {
    scramble: "R U",
    summary: { pauseThresholdMs: 500 },
    validation: { warnings: [] },
    segments: [{
      id: "oll",
      label: "OLL",
      pauses: [],
      pauseWindows: [],
      setupAlg: "R U"
    }],
    cfopAnalysis: {
      stages: [{
        segmentId: "oll",
        label: "OLL",
        stageType: "oll",
        pauses: 0,
        moveCount: 11,
        effectiveMoveCount: 11,
        goal: {
          completed: true,
          evidence: "U-layer orientation target solved under current analysis orientation"
        },
        recognition: {
          oll: {
            matched: true,
            caseId: "27"
          }
        }
      }]
    }
  };

  const ollSuggestion = generateCoachSuggestions(review, { opRecommendationGap: 1 }).suggestions.find((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "oll");

  assert.ok(ollSuggestion);
  assert.equal(ollSuggestion.candidates.length, 1);
  assert.equal(ollSuggestion.candidates[0].caseId, "27");
});

test("generateCoachSuggestions skips OLL/PLL algorithm candidates when move gap is not large enough", () => {
  const review = {
    scramble: "R U",
    summary: { pauseThresholdMs: 500 },
    validation: { warnings: [] },
    segments: [{
      id: "pll",
      label: "PLL",
      pauses: [],
      pauseWindows: [],
      setupAlg: "R U"
    }],
    cfopAnalysis: {
      stages: [{
        segmentId: "pll",
        label: "PLL",
        stageType: "pll",
        pauses: 0,
        moveCount: 14,
        effectiveMoveCount: 14,
        goal: {
          completed: true,
          evidence: "Cube is solved after PLL"
        },
        recognition: {
          pll: {
            matched: true,
            caseId: "T"
          }
        }
      }]
    }
  };

  const pllSuggestion = generateCoachSuggestions(review).suggestions.find((suggestion) => suggestion.type === "algorithm-candidates");

  assert.equal(pllSuggestion, undefined);
});

test("createSolveReview infers cf4op segmentation when segmentedSolution is missing", async () => {
  const review = await createSolveReview({
    scramble: "R U",
    timedMoves: "U'@0 R'@100"
  });

  assert.equal(review.segmentation.source, "inferred-cf4op");
  assert.equal(review.segmentation.method, "cf4op");
  assert.equal(review.validation.ok, true);
  assert.equal(review.validation.warnings.length, 0);
  assert.ok(review.segments.length >= 1);
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

test("runAgentTurn can enhance chat response with llm response enhancer", async () => {
  const turn = await runAgentTurn(
    "你好，帮我简单介绍一下你能做什么",
    {},
    {
      responseEnhancer: async ({ turn: currentTurn, fallbackResponse }) => ({
        ...fallbackResponse,
        text: `LLM:${currentTurn.intent.type}`
      })
    }
  );

  assert.equal(turn.intent.type, "chat");
  assert.equal(turn.toolResult.type, "chat");
  assert.equal(turn.response.text, "LLM:chat");
  assert.equal(turn.fallbackResponse.kind, "chat-fallback");
});

test("runAgentTurn keeps fallback response when llm enhancer fails", async () => {
  const turn = await runAgentTurn(
    "你好，帮我简单介绍一下你能做什么",
    {},
    {
      responseEnhancer: async () => {
        throw new LlmClientError("LLM_NETWORK_OR_CORS", "跨域失败");
      }
    }
  );

  assert.equal(turn.intent.type, "chat");
  assert.equal(turn.response.kind, "chat-fallback");
  assert.match(turn.response.text, /聊天模型接口当前无法从浏览器直接访问/);
  assert.equal(turn.response.llm.status, "fallback");
  assert.equal(turn.response.llm.error.code, "LLM_NETWORK_OR_CORS");
});

test("runAgentTurn uses llm response enhancer for solve import narration", async () => {
  const scramble = "R U R' U'";
  const solution = invertAlg(scramble);
  const turn = await runAgentTurn(
    `
scramble: ${scramble}
timedMoves: ${solution.split(" ").map((move, index) => `${move}@${index * 100}`).join(" ")}
segmentedSolution:
U R // Cross
U' R' // F2L 1
`,
    {},
    {
      responseEnhancer: async ({ turn: currentTurn, fallbackResponse }) => ({
        ...fallbackResponse,
        text: `LLM:${currentTurn.toolResult.type}`
      })
    }
  );

  assert.equal(turn.intent.type, "solve-import");
  assert.equal(turn.toolResult.type, "solve-review");
  assert.equal(turn.response.text, "LLM:solve-review");
  assert.equal(turn.fallbackResponse.kind, "solve-review");
});

test("runAgentTurn exposes fallback turn before llm enhancement", async () => {
  const snapshots = [];
  const turn = await runAgentTurn(
    "给我一个右手 no-rotation 的 OLL 27 公式",
    {},
    {
      onTurnReady: (readyTurn) => {
        snapshots.push(readyTurn);
      },
      responseEnhancer: async ({ fallbackResponse }) => ({
        ...fallbackResponse,
        text: "LLM:algorithm-search"
      })
    }
  );

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].toolResult.type, "algorithm-search");
  assert.equal(snapshots[0].response.kind, "algorithm-search");
  assert.equal(turn.response.text, "LLM:algorithm-search");
});

test("assistant-ui style reload parentId points to the user message itself", () => {
  const messages = [
    { id: "u1", role: "user", text: "first" },
    { id: "a1", role: "assistant", text: "reply" }
  ];

  const parentId = messages[0].id;
  const userIndex = parentId
    ? messages.findIndex((item) => item.id === parentId)
    : 0;

  assert.equal(userIndex, 0);
  assert.equal(messages[userIndex].role, "user");
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

test("buildPromptMessages includes tool result and fallback response", () => {
  const messages = buildPromptMessages({
    message: "F2L 1 这里怎么看？",
    context: {
      selectedSegmentId: "f2l-1"
    },
    turn: {
      intent: { type: "local-followup" },
      toolCalls: [{ name: "readSolveContext", args: { segmentLabel: "F2L 1" } }],
      toolResult: {
        type: "segment-inspection",
        segment: {
          id: "f2l-1",
          label: "F2L 1",
          moveCount: 8,
          durationMs: 1200,
          tps: 6.67,
          pauses: []
        },
        stage: {
          goal: {
            completed: true,
            evidence: "阶段目标完成"
          }
        },
        suggestions: []
      }
    },
    fallbackResponse: {
      kind: "segment-inspection",
      text: "我看了 F2L 1 这一段。"
    }
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");
  assert.match(messages[1].content[0].text, /local-followup/);
  assert.match(messages[1].content[0].text, /segment-inspection/);
  assert.match(messages[1].content[0].text, /fallback/);
});

test("buildPromptMessages uses intent-specific prompt profile", () => {
  const messages = buildPromptMessages({
    message: "给我一个 OLL 27 公式",
    context: {},
    turn: {
      intent: { type: "algorithm-query" },
      toolCalls: [],
      toolResult: {
        type: "algorithm-search",
        result: {
          total: 1,
          query: { set: "OLL", caseId: "27", tags: [] },
          results: []
        }
      }
    },
    fallbackResponse: {
      kind: "algorithm-search",
      text: "本地公式库命中 1 条候选。"
    }
  });

  assert.match(messages[0].content[0].text, /解释公式候选/);
  assert.match(messages[1].content[0].text, /像教练推荐公式/);
});

test("buildPromptMessages adds strict markdown playback link instruction when candidates include playback urls", () => {
  const messages = buildPromptMessages({
    message: "这次 PLL 有没有更好的公式？",
    context: {},
    turn: {
      intent: { type: "solve-import" },
      toolCalls: [],
      toolResult: {
        type: "solve-review",
        review: {
          coachSuggestions: {
            suggestions: [
              {
                type: "algorithm-candidates",
                candidates: [
                  {
                    id: "pll-t-1",
                    alg: "R U R' U'",
                    playback: {
                      url: "https://alg.cubing.net/?alg=R_U_R-_U-&view=playback"
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    },
    fallbackResponse: {
      kind: "solve-review",
      text: "本地有候选公式。"
    }
  });

  assert.match(messages[0].content[0].text, /标准 Markdown 链接格式/);
  assert.match(messages[0].content[0].text, /必须原样使用工具结果里给出的 playback\.url/);
  assert.match(messages[0].content[0].text, /不要写“点击链接查看动画”/);
});

test("buildPromptMessages forbids unsupported praise and filler phrasing", () => {
  const messages = buildPromptMessages({
    message: "帮我看一下这次 PLL",
    context: {},
    turn: {
      intent: { type: "local-followup" },
      toolCalls: [],
      toolResult: {
        type: "segment-inspection",
        segment: {
          id: "pll",
          label: "PLL",
          moveCount: 14,
          durationMs: 1800,
          tps: 7.78,
          pauses: []
        },
        stage: {
          goal: {
            completed: true,
            evidence: "Cube is solved after PLL"
          }
        },
        suggestions: []
      }
    },
    fallbackResponse: {
      kind: "segment-inspection",
      text: "PLL 已分析。"
    }
  });

  assert.match(messages[0].content[0].text, /不要写空话、套话、安慰性表述/);
  assert.match(messages[0].content[0].text, /这次复原没有问题/);
  assert.match(messages[0].content[0].text, /这个 PLL 做得很快/);
});

test("buildPromptMessages skips playback link instruction when no candidate links exist", () => {
  const messages = buildPromptMessages({
    message: "帮我总结一下",
    context: {},
    turn: {
      intent: { type: "chat" },
      toolCalls: [],
      toolResult: {
        type: "chat",
        message: "未命中特定魔方工具，交给普通聊天模型处理。"
      }
    },
    fallbackResponse: {
      kind: "chat-fallback",
      text: "普通回复。"
    }
  });

  assert.match(messages[0].content[0].text, /不需要额外输出链接/);
});

test("buildChatCompletionMessages flattens prompt parts to plain string content", () => {
  const messages = buildChatCompletionMessages([
    {
      role: "system",
      content: [{ type: "input_text", text: "system text" }]
    },
    {
      role: "user",
      content: [{ type: "input_text", text: "user text" }]
    }
  ]);

  assert.deepEqual(messages, [
    { role: "system", content: "system text" },
    { role: "user", content: "user text" }
  ]);
});

test("sanitizeLlmSettings trims baseUrl and keeps explicit values", () => {
  const settings = sanitizeLlmSettings({
    enabled: true,
    baseUrl: "https://api.deepseek.com/v1///",
    apiKey: "sk-test",
    model: "gpt-4o-mini"
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(settings.apiKey, "sk-test");
  assert.equal(settings.model, "gpt-4o-mini");
});

test("sanitizeLlmSettings falls back to defaults", () => {
  const settings = sanitizeLlmSettings({});

  assert.equal(settings.enabled, true);
  assert.equal(settings.baseUrl, defaultLlmSettings.baseUrl);
  assert.equal(settings.model, defaultLlmSettings.model);
});

test("deriveConversationTitle uses first user message excerpt", () => {
  assert.equal(
    deriveConversationTitle("  帮我分析这次 F2L 1 为什么会卡住  "),
    "帮我分析这次 F2L 1 为什么会卡住"
  );
});

test("sanitizeChatState creates fallback conversation when storage is empty", () => {
  const state = sanitizeChatState({});

  assert.equal(state.conversations.length, 1);
  assert.equal(state.currentConversationId, state.conversations[0].id);
  assert.equal(state.conversations[0].title, "新对话");
});

test("createEmptyConversation initializes empty message list", () => {
  const conversation = createEmptyConversation();

  assert.equal(Array.isArray(conversation.messages), true);
  assert.equal(conversation.messages.length, 0);
  assert.equal(conversation.title, "新对话");
});

test("joinChatCompletionsUrl appends chat completions path", () => {
  assert.equal(
    joinChatCompletionsUrl("https://api.deepseek.com/v1/"),
    "https://api.deepseek.com/v1/chat/completions"
  );
});

test("extractChatCompletionText reads standard compatible response", () => {
  const text = extractChatCompletionText({
    choices: [
      {
        message: {
          content: "你好，这里是回答"
        }
      }
    ]
  });

  assert.equal(text, "你好，这里是回答");
});

test("composeResponse includes recognized PLL case in solve-review evidence", async () => {
  const pllAlg = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const review = await createSolveReview({
    scramble: invertAlg(pllAlg),
    timedMoves: pllAlg.split(" ").map((move, index) => `${move}@${index * 120}`).join(" "),
    segmentedSolution: `
${pllAlg} // PLL
`
  });

  const response = composeResponse({
    toolResult: {
      type: "solve-review",
      review
    }
  });

  assert.equal(response.kind, "solve-review");
  assert.ok(response.evidence.some((line) => /PLL 识别：T \(T Perm\)/.test(line)));
});

test("composeResponse includes recognized OLL case in solve-review evidence", async () => {
  const ollAlg = "R U R' U R U2 R'";
  const review = await createSolveReview({
    scramble: invertAlg(ollAlg),
    timedMoves: ollAlg.split(" ").map((move, index) => `${move}@${index * 120}`).join(" "),
    segmentedSolution: `
${ollAlg} // OLL
`
  });

  const response = composeResponse({
    toolResult: {
      type: "solve-review",
      review
    }
  });

  assert.equal(response.kind, "solve-review");
  assert.ok(response.evidence.some((line) => /OLL 识别：27 \(OLL 27 OCLL-27\)/.test(line)));
});

test("composeResponse hides pause and F2L algorithm candidate highlights in solve-review details", async () => {
  const review = await createSolveReview({
    scramble: "R U R' U'",
    timedMoves: "U@0 R@100 U'@900 R'@1100",
    segmentedSolution: `
U R // Cross
U' R' // F2L 1
`
  });

  const response = composeResponse({
    toolResult: {
      type: "solve-review",
      review
    }
  });

  assert.equal(response.kind, "solve-review");
  assert.ok(response.highlights.every((item) => !/明显停顿/.test(item.title)));
  assert.ok(response.highlights.every((item) => !(item.title.includes("候选公式") && item.title.includes("F2L"))));
});
