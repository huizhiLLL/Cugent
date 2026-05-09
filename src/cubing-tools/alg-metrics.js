import { Alg } from "cubing/alg";

const MOVE_SUFFIX_PATTERN = /(?:2|')$/;

export function calculateEffectiveMoveCount(input) {
  return simplifyAlgMoves(input).length;
}

export function simplifyAlgMoves(input) {
  const moves = normalizeMoves(input);
  const stack = [];

  for (const move of moves) {
    const normalized = normalizeMove(move);
    const previous = stack.at(-1);

    if (previous && previous.base === normalized.base) {
      const mergedTurns = (previous.turns + normalized.turns) % 4;
      stack.pop();

      if (mergedTurns !== 0) {
        stack.push({
          base: normalized.base,
          turns: mergedTurns
        });
      }
      continue;
    }

    stack.push(normalized);
  }

  return stack.map(stringifyMove);
}

function normalizeMoves(input) {
  if (Array.isArray(input)) {
    return input.filter(Boolean).map((move) => String(move).trim()).filter(Boolean);
  }

  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }

  const alg = new Alg(raw);
  return Array.from(alg.experimentalLeafMoves(), (move) => move.toString());
}

function normalizeMove(move) {
  const token = String(move).trim();
  const base = token.replace(MOVE_SUFFIX_PATTERN, "");

  if (token.endsWith("2")) {
    return { base, turns: 2 };
  }

  if (token.endsWith("'")) {
    return { base, turns: 3 };
  }

  return { base, turns: 1 };
}

function stringifyMove(move) {
  if (move.turns === 2) {
    return `${move.base}2`;
  }

  if (move.turns === 3) {
    return `${move.base}'`;
  }

  return move.base;
}
