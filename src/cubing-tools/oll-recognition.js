import { Alg } from "cubing/alg";
import { KPattern } from "cubing/kpuzzle";
import { cube3x3x3 } from "cubing/puzzles";
import { isMaskSolved, patternDataToFacelet, toEqus } from "./cfop-progress.js";

const OLL_RECOGNITION_SOURCE = "cstimer-oll-patterns";
const OLL_LL_PATTERN_TEMPLATE = "012345678cdeRRRRRR9abFFFFFFDDDDDDDDDijkLLLLLLfghBBBBBB";
const OLL_STAGE_MASK = toEqus("----U-------RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB");
const OLL_ORIENTATION_ALGS = [
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

const OLL_CASES = [
  createOllCase(1, "1", "OLL 1 Point-1", 0xeba00),
  createOllCase(2, "2", "OLL 2 Point-2", 0xdda00),
  createOllCase(3, "3", "OLL 3 Point-3", 0x5b620),
  createOllCase(4, "4", "OLL 4 Point-4", 0x6d380),
  createOllCase(5, "5", "OLL 5 Square-5", 0x8360b),
  createOllCase(6, "6", "OLL 6 Square-6", 0x60b16),
  createOllCase(7, "7", "OLL 7 SLBS-7", 0x1362a),
  createOllCase(8, "8", "OLL 8 SLBS-8", 0x64392),
  createOllCase(9, "9", "OLL 9 Fish-9", 0x2538a),
  createOllCase(10, "10", "OLL 10 Fish-10", 0x9944c),
  createOllCase(11, "11", "OLL 11 SLBS-11", 0x9160e),
  createOllCase(12, "12", "OLL 12 SLBS-12", 0x44b13),
  createOllCase(13, "13", "OLL 13 Knight-13", 0x1a638),
  createOllCase(14, "14", "OLL 14 Knight-14", 0x2c398),
  createOllCase(15, "15", "OLL 15 Knight-15", 0x8a619),
  createOllCase(16, "16", "OLL 16 Knight-16", 0x28b1c),
  createOllCase(17, "17", "OLL 17 Point-17", 0x4b381),
  createOllCase(18, "18", "OLL 18 Point-18", 0x49705),
  createOllCase(19, "19", "OLL 19 Point-19", 0xc9a05),
  createOllCase(20, "20", "OLL 20 CO-20", 0x492a5),
  createOllCase(21, "21", "OLL 21 OCLL-21", 0x1455a),
  createOllCase(22, "22", "OLL 22 OCLL-22", 0xa445a),
  createOllCase(23, "23", "OLL 23 OCLL-23", 0x140fa),
  createOllCase(24, "24", "OLL 24 OCLL-24", 0x101de),
  createOllCase(25, "25", "OLL 25 OCLL-25", 0x2047e),
  createOllCase(26, "26", "OLL 26 OCLL-26", 0x2095e),
  createOllCase(27, "27", "OLL 27 OCLL-27", 0x1247a),
  createOllCase(28, "28", "OLL 28 CO-28", 0x012af),
  createOllCase(29, "29", "OLL 29 Awkward-29", 0x1138e),
  createOllCase(30, "30", "OLL 30 Awkward-30", 0x232aa),
  createOllCase(31, "31", "OLL 31 P-31", 0x50396),
  createOllCase(32, "32", "OLL 32 P-32", 0x0562b),
  createOllCase(33, "33", "OLL 33 T-33", 0x1839c),
  createOllCase(34, "34", "OLL 34 C-34", 0x2a2b8),
  createOllCase(35, "35", "OLL 35 Fish-35", 0x4a1d1),
  createOllCase(36, "36", "OLL 36 W-36", 0xc4293),
  createOllCase(37, "37", "OLL 37 Fish-37", 0x0338b),
  createOllCase(38, "38", "OLL 38 W-38", 0x11a2e),
  createOllCase(39, "39", "OLL 39 BLBS-39", 0x18a3c),
  createOllCase(40, "40", "OLL 40 BLBS-40", 0x8c299),
  createOllCase(41, "41", "OLL 41 Awkward-41", 0x152aa),
  createOllCase(42, "42", "OLL 42 Awkward-42", 0x0954d),
  createOllCase(43, "43", "OLL 43 P-43", 0xe0296),
  createOllCase(44, "44", "OLL 44 P-44", 0x03a2b),
  createOllCase(45, "45", "OLL 45 T-45", 0xa829c),
  createOllCase(46, "46", "OLL 46 C-46", 0x43863),
  createOllCase(47, "47", "OLL 47 L-47", 0x52b12),
  createOllCase(48, "48", "OLL 48 L-48", 0xa560a),
  createOllCase(49, "49", "OLL 49 L-49", 0xe4612),
  createOllCase(50, "50", "OLL 50 L-50", 0xec450),
  createOllCase(51, "51", "OLL 51 I-51", 0x1ab18),
  createOllCase(52, "52", "OLL 52 I-52", 0x53942),
  createOllCase(53, "53", "OLL 53 L-53", 0x54712),
  createOllCase(54, "54", "OLL 54 L-54", 0x1570a),
  createOllCase(55, "55", "OLL 55 I-55", 0x1c718),
  createOllCase(56, "56", "OLL 56 I-56", 0xaaa18),
  createOllCase(57, "57", "OLL 57 CO-57", 0x082bd)
];

let cachedKPuzzlePromise;

export async function identifyOllCaseFromPatternData(patternData) {
  const kpuzzle = await getKPuzzle();
  const pattern = new KPattern(kpuzzle, patternData);
  return identifyOllCaseFromPattern(pattern);
}

export async function identifyOllCaseFromPattern(pattern) {
  let stageVerified = false;

  for (const orientation of OLL_ORIENTATION_ALGS) {
    const orientedPattern = orientation.label === "identity"
      ? pattern
      : pattern.applyAlg(orientation.alg);
    const facelet = patternDataToFacelet(orientedPattern.toJSON().patternData);

    if (!isMaskSolved(facelet, OLL_STAGE_MASK)) {
      continue;
    }

    stageVerified = true;

    for (const ollCase of OLL_CASES) {
      if (isMaskSolved(facelet, ollCase.mask)) {
        return {
          set: "OLL",
          source: OLL_RECOGNITION_SOURCE,
          matched: true,
          stageVerified,
          caseId: ollCase.caseId,
          name: ollCase.name,
          index: ollCase.index,
          orientation: orientation.label,
          facelet
        };
      }
    }
  }

  return {
    set: "OLL",
    source: OLL_RECOGNITION_SOURCE,
    matched: false,
    stageVerified,
    caseId: null,
    name: null,
    index: null,
    orientation: null,
    facelet: null
  };
}

export function listRecognizableOllCases() {
  return OLL_CASES.map((ollCase) => ({
    index: ollCase.index,
    caseId: ollCase.caseId,
    name: ollCase.name
  }));
}

function createOllCase(index, caseId, name, encodedMask) {
  const llPattern = decodeOllFace(encodedMask);
  const maskedPattern = llPattern.replace(/G/g, "-");

  return {
    index,
    caseId,
    name,
    encodedMask,
    llPattern,
    mask: toEqus(OLL_LL_PATTERN_TEMPLATE.replace(/[0-9a-z]/g, (value) => maskedPattern[parseInt(value, 36)].toLowerCase()))
  };
}

function decodeOllFace(encodedMask) {
  let value = encodedMask;
  let face = "";
  for (let index = 0; index < 21; index += 1) {
    if (index === 4) {
      face += "D";
      continue;
    }
    face += (value & 1) ? "D" : "G";
    value >>= 1;
  }
  return face;
}

async function getKPuzzle() {
  cachedKPuzzlePromise ||= cube3x3x3.kpuzzle();
  return cachedKPuzzlePromise;
}
