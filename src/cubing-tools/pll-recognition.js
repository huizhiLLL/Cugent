import { Alg } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { cube3x3x3 } from "cubing/puzzles";
import { isMaskSolved, patternDataToFacelet, toEqus } from "./cfop-progress.js";

const PLL_RECOGNITION_SOURCE = "cstimer-pll-patterns";
const PLL_LL_PATTERN_TEMPLATE = "012345678cdeRRRRRR9abFFFFFFDDDDDDDDDijkLLLLLLfghBBBBBB";
const PLL_STAGE_MASK = toEqus("UUUUUUUUU---RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB");
const PLL_ORIENTATION_ALGS = [
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
].map((rotation) => ({
  alg: new Alg(rotation),
  label: rotation || "identity"
}));

const PLL_CASES = [
  createPllCase(0, "H", "H Perm", "BFBRLRFBFLRL"),
  createPllCase(1, "Ua", "Ua Perm", "BRBRLRFFFLBL"),
  createPllCase(2, "Ub", "Ub Perm", "BLBRBRFFFLRL"),
  createPllCase(3, "Z", "Z Perm", "LFLBRBRBRFLF"),
  createPllCase(4, "Aa", "Aa Perm", "LBBRRLBFRFLF"),
  createPllCase(5, "Ab", "Ab Perm", "RBFLRRFFLBLB"),
  createPllCase(6, "E", "E Perm", "LBRFRBRFLBLF"),
  createPllCase(7, "F", "F Perm", "BFRFRBRBFLLL"),
  createPllCase(8, "Ga", "Ga Perm", "BRRFLBRBFLFL"),
  createPllCase(9, "Gb", "Gb Perm", "BFRFBBRLFLRL"),
  createPllCase(10, "Gc", "Gc Perm", "BFRFLBRRFLBL"),
  createPllCase(11, "Gd", "Gd Perm", "BLRFFBRBFLRL"),
  createPllCase(12, "Ja", "Ja Perm", "BBRFFBRRFLLL"),
  createPllCase(13, "Jb", "Jb Perm", "LBBRLLBRRFFF"),
  createPllCase(14, "Na", "Na Perm", "FBBRLLBFFLRR"),
  createPllCase(15, "Nb", "Nb Perm", "BBFLLRFFBRRL"),
  createPllCase(16, "Ra", "Ra Perm", "LLBRBLBFRFRF"),
  createPllCase(17, "Rb", "Rb Perm", "RBFLFRFLLBRB"),
  createPllCase(18, "T", "T Perm", "BBRFLBRFFLRL"),
  createPllCase(19, "V", "V Perm", "BBFLFRFRBRLL"),
  createPllCase(20, "Y", "Y Perm", "BBFLRRFLBRFL"),
  createPllCase(21, "Solved", "Solved PLL", "UUUUUUUUUFFFRRRBBBLLL")
];

let cachedKPuzzlePromise;

export async function identifyPllCaseFromPatternData(patternData) {
  const kpuzzle = await getKPuzzle();
  const pattern = new KPattern(kpuzzle, patternData);
  return identifyPllCaseFromPattern(pattern);
}

export async function identifyPllCaseFromPattern(pattern) {
  let stageVerified = false;

  for (const orientation of PLL_ORIENTATION_ALGS) {
    const orientedPattern = orientation.label === "identity"
      ? pattern
      : pattern.applyAlg(orientation.alg);
    const facelet = patternDataToFacelet(orientedPattern.toJSON().patternData);

    if (!isMaskSolved(facelet, PLL_STAGE_MASK)) {
      continue;
    }

    stageVerified = true;

    for (const pllCase of PLL_CASES) {
      if (isMaskSolved(facelet, pllCase.mask)) {
        return {
          set: "PLL",
          source: PLL_RECOGNITION_SOURCE,
          matched: true,
          stageVerified,
          caseId: pllCase.caseId,
          name: pllCase.name,
          index: pllCase.index,
          orientation: orientation.label,
          facelet
        };
      }
    }
  }

  return {
    set: "PLL",
    source: PLL_RECOGNITION_SOURCE,
    matched: false,
    stageVerified,
    caseId: null,
    name: null,
    index: null,
    orientation: null,
    facelet: null
  };
}

export function listRecognizablePllCases() {
  return PLL_CASES.map((pllCase) => ({
    index: pllCase.index,
    caseId: pllCase.caseId,
    name: pllCase.name
  }));
}

function createPllCase(index, caseId, name, llPattern) {
  const normalizedPattern = llPattern.length === 12
    ? `UUUUUUUUU${llPattern}`
    : llPattern;

  return {
    index,
    caseId,
    name,
    llPattern: normalizedPattern,
    mask: toEqus(PLL_LL_PATTERN_TEMPLATE.replace(/[0-9a-z]/g, (value) => normalizedPattern[parseInt(value, 36)].toLowerCase()))
  };
}

async function getKPuzzle() {
  cachedKPuzzlePromise ||= cube3x3x3.kpuzzle();
  return cachedKPuzzlePromise;
}
