const MOVE_PATTERN = /^([URFDLBMESxyzurfdlb](?:w)?(?:2|')?)@(\d+)$/;

export function parseTimedMoves(input) {
  const raw = normalizeTimedMovesInput(input);
  if (!raw.trim()) {
    throw new Error("timedMoves 不能为空");
  }

  const tokens = raw.trim().split(/\s+/);
  let previousTimestamp = -1;

  return tokens.map((token, index) => {
    const match = token.match(MOVE_PATTERN);
    if (!match) {
      throw new Error(`非法 timed move：${token}`);
    }

    const timestampMs = Number(match[2]);
    if (!Number.isSafeInteger(timestampMs)) {
      throw new Error(`非法 timestamp：${token}`);
    }
    if (timestampMs < previousTimestamp) {
      throw new Error(`timestamp 必须递增：${token}`);
    }

    const deltaMs = index === 0 ? 0 : timestampMs - previousTimestamp;
    previousTimestamp = timestampMs;

    return {
      index,
      move: match[1],
      timestampMs,
      deltaMs,
      segmentId: null
    };
  });
}

export function parseSegmentedSolution(input) {
  if (!input || !input.trim()) {
    return [];
  }

  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [algPart, labelPart] = line.split(/\s*\/\/\s*/, 2);
      if (!labelPart) {
        throw new Error(`分段行缺少 // label：${line}`);
      }

      const moves = parsePlainAlgMoves(algPart);
      return {
        id: normalizeSegmentId(labelPart, index),
        label: labelPart.trim(),
        moves,
        moveCount: moves.length
      };
    });
}

export function parsePlainAlgMoves(input) {
  if (!input || !input.trim()) {
    return [];
  }

  return input
    .trim()
    .split(/\s+/)
    .map((move) => {
      if (!MOVE_PATTERN.test(`${move}@0`)) {
        throw new Error(`非法 move：${move}`);
      }
      return move;
    });
}

function normalizeTimedMovesInput(input) {
  if (Array.isArray(input)) {
    return String(input[0] ?? "");
  }

  const trimmed = String(input ?? "").trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return String(parsed[0] ?? "");
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function normalizeSegmentId(label, index) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `segment-${index + 1}`;
}
