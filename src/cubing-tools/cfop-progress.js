import { Alg } from "cubing/alg";

const ORIENTATION_ALGS = [
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
].map((alg) => new Alg(alg));

const reidEdgeOrder = "UF UR UB UL DF DR DB DL FR FL BR BL".split(" ");
const reidCornerOrder = "UFR URB UBL ULF DRF DFL DLB DBR".split(" ");
const faceNames = "ULFRBD".split("");
const faceletMap = [
  [1, 2, 0], [0, 2, 0], [1, 1, 0],
  [0, 3, 0], [2, 0, 0], [0, 1, 0],
  [1, 3, 0], [0, 0, 0], [1, 0, 0],
  [1, 0, 2], [0, 1, 1], [1, 1, 1],
  [0, 8, 1], [2, 3, 0], [0, 10, 1],
  [1, 4, 1], [0, 5, 1], [1, 7, 2],
  [1, 3, 2], [0, 0, 1], [1, 0, 1],
  [0, 9, 0], [2, 2, 0], [0, 8, 0],
  [1, 5, 1], [0, 4, 1], [1, 4, 2],
  [1, 5, 0], [0, 4, 0], [1, 4, 0],
  [0, 7, 0], [2, 5, 0], [0, 5, 0],
  [1, 6, 0], [0, 6, 0], [1, 7, 0],
  [1, 2, 2], [0, 3, 1], [1, 3, 1],
  [0, 11, 1], [2, 1, 0], [0, 9, 1],
  [1, 6, 1], [0, 7, 1], [1, 5, 2],
  [1, 1, 2], [0, 2, 1], [1, 2, 1],
  [0, 10, 0], [2, 4, 0], [0, 11, 0],
  [1, 7, 1], [0, 6, 1], [1, 6, 2]
];

const crossMask = toEqus("----U--------R--R-----F--F--D-DDD-D-----L--L-----B--B-");
const f2l1Mask = toEqus("----U-------RR-RR-----FF-FF-DDDDD-D-----L--L-----B--B-");
const f2l2Mask = toEqus("----U--------R--R----FF-FF-DD-DDD-D-----LL-LL----B--B-");
const f2l3Mask = toEqus("----U--------RR-RR----F--F--D-DDD-DD----L--L----BB-BB-");
const f2l4Mask = toEqus("----U--------R--R-----F--F--D-DDDDD----LL-LL-----BB-BB");
const f2lMask = toEqus("----U-------RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB");
const ollMask = toEqus("UUUUUUUUU---RRRRRR---FFFFFFDDDDDDDDD---LLLLLL---BBBBBB");
const solvedMask = toEqus("UUUUUUUUULLLLLLLLLFFFFFFFFFRRRRRRRRRBBBBBBBBBDDDDDDDDD");

export function getCf4opProgressByOrientation(pattern) {
  return ORIENTATION_ALGS.map((rotation) => {
    const orientedPattern = rotation.toString() ? pattern.applyAlg(rotation) : pattern;
    return getCf4opProgressFromPatternData(orientedPattern.toJSON().patternData);
  });
}

export function getCf4opProgressFromPattern(pattern) {
  return Math.min(...getCf4opProgressByOrientation(pattern));
}

export function getCf4opProgressFromPatternData(patternData) {
  const facelet = patternDataToFacelet(patternData);

  if (!isMaskSolved(facelet, crossMask)) {
    return 7;
  }

  if (!isMaskSolved(facelet, f2lMask)) {
    return 2
      + Number(!isMaskSolved(facelet, f2l1Mask))
      + Number(!isMaskSolved(facelet, f2l2Mask))
      + Number(!isMaskSolved(facelet, f2l3Mask))
      + Number(!isMaskSolved(facelet, f2l4Mask));
  }

  if (!isMaskSolved(facelet, ollMask)) {
    return 2;
  }

  if (!isMaskSolved(facelet, solvedMask)) {
    return 1;
  }

  return 0;
}

export function patternDataToFacelet(patternData) {
  const faceMap = buildOriginalToCurrentFaceMap(patternData);
  const mapSticker = (sticker) => sticker.split("").map((face) => faceMap[face]).join("");
  const reid = [
    patternData.EDGES.pieces.map((piece, index) => (
      mapSticker(rotateLeft(reidEdgeOrder[piece], patternData.EDGES.orientation[index]))
    )),
    patternData.CORNERS.pieces.map((piece, index) => (
      mapSticker(rotateLeft(reidCornerOrder[piece], patternData.CORNERS.orientation[index]))
    )),
    faceNames
  ];

  return faceletMap.map(([orbit, perm, orientation]) => reid[orbit][perm][orientation]).join("");
}

function buildOriginalToCurrentFaceMap(patternData) {
  const faceMap = {};

  for (let currentFaceIndex = 0; currentFaceIndex < faceNames.length; currentFaceIndex += 1) {
    const originalFaceIndex = patternData.CENTERS.pieces[currentFaceIndex];
    faceMap[faceNames[originalFaceIndex]] = faceNames[currentFaceIndex];
  }

  return faceMap;
}

function rotateLeft(value, amount) {
  return value.slice(amount) + value.slice(0, amount);
}

export function toEqus(facelet) {
  const colorToIndices = {};
  for (let index = 0; index < facelet.length; index += 1) {
    const color = facelet[index];
    if (color === "-") {
      continue;
    }

    colorToIndices[color] = colorToIndices[color] || [];
    colorToIndices[color].push(index);
  }

  return Object.values(colorToIndices).filter((indices) => indices.length > 1);
}

export function isMaskSolved(facelet, mask) {
  return mask.every((equivalenceGroup) => equivalenceGroup.every((index) => facelet[index] === facelet[equivalenceGroup[0]]));
}
