import { invertAlg } from "../src/cubing-tools/index.js";
import { runAgentTurn } from "../src/agent-runtime/index.js";

const scramble = "R U R' U'";
const solution = invertAlg(scramble);
const solveMessage = `
scramble: ${scramble}
timedMoves: ${solution.split(" ").map((move, index) => `${move}@${index * 250}`).join(" ")}
segmentedSolution:
${solution.split(" ").slice(0, 2).join(" ")} // Cross
${solution.split(" ").slice(2).join(" ")} // F2L 1
`;

let context = {};

const solveTurn = await runAgentTurn(solveMessage, context);
context = { ...context, ...solveTurn.contextPatch };

console.log("Solve import");
console.log("============");
console.log(`intent=${solveTurn.intent.type}`);
console.log(`tool=${solveTurn.toolCalls[0].name}`);
console.log(`moves=${solveTurn.toolResult.review.summary.totalMoves}`);
console.log(`suggestions=${solveTurn.toolResult.review.coachSuggestions.suggestions.length}`);
console.log(solveTurn.response.text);

const algorithmTurn = await runAgentTurn("给我一个右手 no-rotation 的 OLL 27 公式", context);
console.log("");
console.log("Algorithm query");
console.log("===============");
console.log(`intent=${algorithmTurn.intent.type}`);
console.log(`tool=${algorithmTurn.toolCalls[0].name}`);
console.log(`results=${algorithmTurn.toolResult.result.total}`);
console.log(algorithmTurn.response.text);

const followupTurn = await runAgentTurn("F2L 1 这里怎么样？", context);
console.log("");
console.log("Local followup");
console.log("==============");
console.log(`intent=${followupTurn.intent.type}`);
console.log(`tool=${followupTurn.toolCalls[0].name}`);
console.log(`segment=${followupTurn.toolResult.segment.label}`);
console.log(`suggestions=${followupTurn.toolResult.suggestions.length}`);
console.log(followupTurn.response.text);
