import assert from "node:assert/strict";
import test from "node:test";
import { Alg } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { cube3x3x3 } from "cubing/puzzles";
import {
  buildPlaybackBBCode,
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
  traceCubeState
} from "../src/cubing-tools/index.js";
import { buildPromptMessages, composeResponse, detectIntent, runAgentTurn } from "../src/agent-runtime/index.js";

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

  assert.equal(inferred.orientationIndex, null);
  assert.deepEqual(
    inferred.progressTrace.map((entry) => entry.progress),
    [7, 7, 6, 7, 5]
  );
  assert.deepEqual(
    inferred.segments.map((segment) => segment.label),
    ["Cross", "F2L 1"]
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
  assert.ok(suggestions.some((suggestion) => suggestion.type === "algorithm-candidates"));
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

test("generateCoachSuggestions uses recognized PLL caseId in algorithm candidates", async () => {
  const pllAlg = "R U R' U' R' F R2 U' R' U' R U R' F'";
  const review = await createSolveReview({
    scramble: invertAlg(pllAlg),
    timedMoves: pllAlg.split(" ").map((move, index) => `${move}@${index * 120}`).join(" "),
    segmentedSolution: `
${pllAlg} // PLL
`
  });

  const pllSuggestion = review.coachSuggestions.suggestions.find((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "pll");

  assert.ok(pllSuggestion);
  assert.ok(pllSuggestion.candidates);
  assert.equal(review.segments[0].recognition?.pll?.caseId, "T");
  assert.equal(pllSuggestion.candidates.length, 1);
  assert.equal(pllSuggestion.candidates[0].caseId, "T");
});

test("generateCoachSuggestions relaxes no-rotation filter for recognized PLL case fallback", async () => {
  const pllAlg = "x R' U R' D2 R U' R' D2 R2 x'";
  const review = await createSolveReview({
    scramble: invertAlg(pllAlg),
    timedMoves: pllAlg.split(" ").map((move, index) => `${move}@${index * 120}`).join(" "),
    segmentedSolution: `
${pllAlg} // PLL
`
  });

  const pllSuggestion = review.coachSuggestions.suggestions.find((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "pll");

  assert.ok(pllSuggestion);
  assert.equal(review.segments[0].recognition?.pll?.caseId, "Aa");
  assert.equal(pllSuggestion.candidates.length, 1);
  assert.equal(pllSuggestion.candidates[0].caseId, "Aa");
});

test("generateCoachSuggestions uses recognized OLL caseId in algorithm candidates", async () => {
  const ollAlg = "R U R' U R U2 R'";
  const review = await createSolveReview({
    scramble: invertAlg(ollAlg),
    timedMoves: ollAlg.split(" ").map((move, index) => `${move}@${index * 120}`).join(" "),
    segmentedSolution: `
${ollAlg} // OLL
`
  });

  const ollSuggestion = review.coachSuggestions.suggestions.find((suggestion) => suggestion.type === "algorithm-candidates" && suggestion.target?.stageType === "oll");

  assert.ok(ollSuggestion);
  assert.ok(ollSuggestion.candidates);
  assert.equal(review.segments[0].recognition?.oll?.caseId, "27");
  assert.equal(ollSuggestion.candidates.length, 1);
  assert.equal(ollSuggestion.candidates[0].caseId, "27");
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
        throw new Error("network");
      }
    }
  );

  assert.equal(turn.intent.type, "chat");
  assert.equal(turn.response.kind, "chat-fallback");
  assert.equal(turn.response.text, turn.fallbackResponse.text);
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
