const TIMED_MOVE_PATTERN = /[URFDLBMESxyzurfdlb](?:w)?(?:2|')?@\d+/;
const SEGMENT_PATTERN = /\/\/\s*(Cross|F2L|OLL|PLL)/i;
const SCRAMBLE_PATTERN = /^[ \t]*(?:scramble|打乱)[ \t]*[:：][ \t]*(.*)$/im;
const TIMED_MOVES_PATTERN = /^[ \t]*(?:timedMoves|timed moves|moves|review|复盘)[ \t]*[:：][ \t]*([\s\S]*?)(?=^[ \t]*(?:(?:segmentedSolution|segmented solution|segments|solution|scramble|打乱)[ \t]*[:：])|\s*$)/im;
const SEGMENTED_SOLUTION_PATTERN = /^[ \t]*(?:segmentedSolution|segmented solution|segments|solution|分段)[ \t]*[:：][ \t]*([\s\S]*)$/im;
const PLL_CASE_PATTERN = /\b(Aa|Ab|Ua|Ub|Z|H|T|F|E|N|V|Y|Na|Nb|Ga|Gb|Gc|Gd|Ja|Jb|Ra|Rb)\b/i;

export function detectIntent(message) {
  const text = String(message ?? "");

  if (looksLikeSolveImport(text)) {
    return {
      type: "solve-import",
      confidence: 0.92,
      params: extractSolveImportParams(text)
    };
  }

  const segmentQuery = extractSegmentQuery(text);
  if (segmentQuery) {
    return {
      type: "local-followup",
      confidence: 0.68,
      params: segmentQuery
    };
  }

  const algorithmQuery = extractAlgorithmQuery(text);
  if (algorithmQuery) {
    return {
      type: "algorithm-query",
      confidence: 0.82,
      params: algorithmQuery
    };
  }

  return {
    type: "chat",
    confidence: 0.5,
    params: {}
  };
}

function looksLikeSolveImport(text) {
  return Boolean(SCRAMBLE_PATTERN.test(text) && TIMED_MOVES_PATTERN.test(text)) || (TIMED_MOVE_PATTERN.test(text) && SEGMENT_PATTERN.test(text));
}

function extractSolveImportParams(text) {
  const scramble = text.match(SCRAMBLE_PATTERN)?.[1]?.trim() ?? "";
  const timedMoves = text.match(TIMED_MOVES_PATTERN)?.[1]?.trim() ?? extractTimedMovesFallback(text);
  const segmentedSolution = text.match(SEGMENTED_SOLUTION_PATTERN)?.[1]?.trim() ?? extractSegmentedSolutionFallback(text);

  return {
    puzzle: "333",
    source: "chat",
    scramble,
    timedMoves,
    segmentedSolution
  };
}

function extractAlgorithmQuery(text) {
  const explicitSet = text.match(/\b(F2L|OLL|PLL)\b/i)?.[1]?.toUpperCase();
  const barePllCase = text.match(PLL_CASE_PATTERN)?.[1];
  const hasAlgorithmCue = Boolean(explicitSet || barePllCase);

  if (!hasAlgorithmCue) {
    return null;
  }

  const caseId = text.match(/\b(?:case|编号|公式|oll|pll)\s*[:#-]?\s*([A-Za-z]?[0-9]+|[A-Za-z]{1,2})\b/i)?.[1];
  const tags = [];
  if (/右手|right[- ]?hand/i.test(text)) {
    tags.push("right-hand");
  }
  if (/左手|left[- ]?hand/i.test(text)) {
    tags.push("left-hand");
  }
  if (/少转体|不转体|no[- ]?rotation/i.test(text)) {
    tags.push("no-rotation");
  }
  if (/新手|简单|beginner/i.test(text)) {
    tags.push("beginner-friendly");
  }

  return {
    set: explicitSet ?? "PLL",
    caseId: caseId ?? barePllCase ?? null,
    tags
  };
}

function extractSegmentQuery(text) {
  const segmentLabel = text.match(/\b(Cross|F2L\s*\d*|OLL|PLL)\b/i)?.[1];
  if (!segmentLabel) {
    return null;
  }

  if (/公式|case|候选|推荐|algorithm/i.test(text)) {
    return null;
  }

  return {
    segmentLabel: segmentLabel.replace(/\s+/g, " ").trim()
  };
}

function extractTimedMovesFallback(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => TIMED_MOVE_PATTERN.test(line))
    .join(" ")
    .trim();
}

function extractSegmentedSolutionFallback(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => SEGMENT_PATTERN.test(line))
    .join("\n")
    .trim();
}
