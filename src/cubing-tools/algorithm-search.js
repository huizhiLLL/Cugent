import f2lAlgorithms from "../../data/algorithms/f2l.json" with { type: "json" };
import ollAlgorithms from "../../data/algorithms/oll.json" with { type: "json" };
import pllAlgorithms from "../../data/algorithms/pll.json" with { type: "json" };
import { calculateEffectiveMoveCount } from "./alg-metrics.js";
import { buildAlgCubingNetUrl, buildPlaybackBBCode } from "./playback-url.js";

const ALGORITHMS = [...f2lAlgorithms, ...ollAlgorithms, ...pllAlgorithms];

export function searchAlgorithms({
  set,
  caseId,
  tags = [],
  limit = 10,
  includePlayback = true
} = {}) {
  const normalizedSet = set?.trim().toUpperCase();
  const normalizedCaseId = caseId?.trim().toLowerCase();
  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);

  const results = ALGORITHMS
    .filter((algorithm) => {
      if (normalizedSet && algorithm.set !== normalizedSet) {
        return false;
      }
      if (normalizedCaseId && algorithm.caseId.toLowerCase() !== normalizedCaseId) {
        return false;
      }
      return normalizedTags.every((tag) => algorithm.tags.map((item) => item.toLowerCase()).includes(tag));
    })
    .sort(compareAlgorithms)
    .slice(0, limit)
    .map((algorithm) => enrichAlgorithm(algorithm, includePlayback));

  return {
    query: {
      set: normalizedSet || null,
      caseId: caseId || null,
      tags: normalizedTags,
      limit
    },
    total: results.length,
    results
  };
}

export function listAlgorithmSets() {
  return [...new Set(ALGORITHMS.map((algorithm) => algorithm.set))].sort();
}

function enrichAlgorithm(algorithm, includePlayback) {
  const metrics = {
    ...algorithm.metrics,
    effectiveMoveCount: calculateEffectiveMoveCount(algorithm.alg)
  };

  if (!includePlayback) {
    return {
      ...algorithm,
      metrics
    };
  }

  return {
    ...algorithm,
    metrics,
    playback: {
      url: buildAlgCubingNetUrl({ alg: algorithm.alg }),
      bbcode: buildPlaybackBBCode({ alg: algorithm.alg, label: algorithm.name })
    }
  };
}

function compareAlgorithms(a, b) {
  return (
    Number(a.metrics.hasRotation) - Number(b.metrics.hasRotation) ||
    a.metrics.sliceMoves - b.metrics.sliceMoves ||
    a.metrics.moveCount - b.metrics.moveCount ||
    a.name.localeCompare(b.name)
  );
}
