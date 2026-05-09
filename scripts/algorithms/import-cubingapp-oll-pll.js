import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Alg } from "cubing/alg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

const DEFAULT_SOURCE_ROOT = path.join(projectRoot, "tmp", "cubingapp", "alg-codegen", "algs");
const DEFAULT_OUTPUT_ROOT = path.join(projectRoot, "data", "algorithms");
const DEFAULT_MAX_PER_CASE = 3;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(projectRoot, options.sourceRoot);
  const outputRoot = path.resolve(projectRoot, options.outputRoot);

  const ollSource = await loadSourceJson(path.join(sourceRoot, "OLL.json"));
  const pllSource = await loadSourceJson(path.join(sourceRoot, "PLL.json"));

  const ollAlgorithms = convertAlgorithms({
    source: ollSource,
    set: "OLL",
    maxPerCase: options.maxPerCase
  });
  const pllAlgorithms = convertAlgorithms({
    source: pllSource,
    set: "PLL",
    maxPerCase: options.maxPerCase
  });

  await mkdir(outputRoot, { recursive: true });
  await writeJson(path.join(outputRoot, "oll.json"), ollAlgorithms);
  await writeJson(path.join(outputRoot, "pll.json"), pllAlgorithms);

  console.log(`Imported ${ollAlgorithms.length} OLL algorithms and ${pllAlgorithms.length} PLL algorithms.`);
  console.log(`Source root: ${sourceRoot}`);
  console.log(`Output root: ${outputRoot}`);
}

function parseArgs(argv) {
  const options = {
    sourceRoot: DEFAULT_SOURCE_ROOT,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    maxPerCase: DEFAULT_MAX_PER_CASE
  };

  for (const arg of argv) {
    if (arg.startsWith("--source-root=")) {
      options.sourceRoot = arg.slice("--source-root=".length);
      continue;
    }

    if (arg.startsWith("--output-root=")) {
      options.outputRoot = arg.slice("--output-root=".length);
      continue;
    }

    if (arg.startsWith("--max-per-case=")) {
      const raw = Number.parseInt(arg.slice("--max-per-case=".length), 10);
      if (!Number.isFinite(raw) || raw < 1) {
        throw new Error(`Invalid --max-per-case value: ${arg}`);
      }
      options.maxPerCase = raw;
      continue;
    }

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function loadSourceJson(filePath) {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

function convertAlgorithms({ source, set, maxPerCase }) {
  const entries = [];
  const normalizedSet = set.toUpperCase();

  for (const [caseName, caseData] of Object.entries(source.cases ?? {})) {
    const caseId = extractCaseId({ set: normalizedSet, caseName });
    const subsetTag = normalizeSubsetTag(caseData.subset);
    const algEntries = Object.entries(caseData.algs ?? {}).slice(0, maxPerCase);

    algEntries.forEach(([alg, metadata], index) => {
      const metrics = calculateMetrics(alg);
      const tags = buildTags({
        subsetTag,
        hasRotation: metrics.hasRotation,
        sliceMoves: metrics.sliceMoves,
        note: metadata?.note
      });

      entries.push({
        id: buildId({ set: normalizedSet, caseId, index: index + 1 }),
        set: normalizedSet,
        caseId,
        name: buildDisplayName({ set: normalizedSet, caseId, caseName, note: metadata?.note, index }),
        alg: normalizeAlgorithmSpacing(alg),
        tags,
        metrics
      });
    });
  }

  return entries;
}

function extractCaseId({ set, caseName }) {
  const trimmed = String(caseName ?? "").trim();

  if (set === "OLL") {
    const match = trimmed.match(/^OLL\s+(\d+)$/i);
    if (!match) {
      throw new Error(`Unable to extract OLL caseId from "${caseName}"`);
    }
    return match[1];
  }

  if (set === "PLL") {
    const match = trimmed.match(/^([A-Za-z]+)\s+perm$/i);
    if (!match) {
      throw new Error(`Unable to extract PLL caseId from "${caseName}"`);
    }
    return normalizePllCaseId(match[1]);
  }

  throw new Error(`Unsupported set: ${set}`);
}

function normalizePllCaseId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("PLL caseId is empty");
  }

  if (raw.length === 1) {
    return raw.toUpperCase();
  }

  return raw[0].toUpperCase() + raw.slice(1).toLowerCase();
}

function buildId({ set, caseId, index }) {
  return `${set.toLowerCase()}-${slugify(caseId)}-${String(index).padStart(2, "0")}`;
}

function buildDisplayName({ set, caseId, caseName, note, index }) {
  const trimmedCaseName = String(caseName ?? "").trim();
  const trimmedNote = String(note ?? "").trim();

  if (set === "PLL") {
    return trimmedCaseName
      .replace(/\bperm\b/i, "Perm")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (trimmedNote && index === 0) {
    return `${set} ${caseId} ${trimmedNote}`;
  }

  return trimmedCaseName || `${set} ${caseId}`;
}

function calculateMetrics(alg) {
  const moves = Array.from(new Alg(alg).experimentalLeafMoves(), (move) => move.toString());
  const moveCount = moves.length;
  const hasRotation = moves.some((move) => /^[xyz]/i.test(stripMoveSuffix(move)));
  const sliceMoves = moves.filter((move) => /^[MES]/.test(stripMoveSuffix(move))).length;

  return {
    moveCount,
    hasRotation,
    sliceMoves
  };
}

function buildTags({ subsetTag, hasRotation, sliceMoves, note }) {
  const tags = new Set();

  if (subsetTag) {
    tags.add(subsetTag);
  }

  if (!hasRotation) {
    tags.add("no-rotation");
  }

  if (sliceMoves > 0) {
    tags.add("slice");
  }

  const normalizedNote = String(note ?? "").toLowerCase();
  if (normalizedNote.includes("sune")) {
    tags.add("sune-family");
  }
  if (normalizedNote.includes("antisune")) {
    tags.add("antisune-family");
  }

  return Array.from(tags);
}

function normalizeSubsetTag(subset) {
  const raw = String(subset ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  return raw
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAlgorithmSpacing(alg) {
  return String(alg ?? "").replace(/\s+/g, " ").trim();
}

function stripMoveSuffix(move) {
  return String(move ?? "").replace(/[2']+$/g, "");
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function writeJson(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(filePath, content, "utf8");
}

function printHelp() {
  console.log(`
Usage:
  node scripts/algorithms/import-cubingapp-oll-pll.js [options]

Options:
  --source-root=<path>    CubingApp alg JSON directory
  --output-root=<path>    Output directory for oll.json / pll.json
  --max-per-case=<n>      Max algorithms to keep per case (default: ${DEFAULT_MAX_PER_CASE})
  --help                  Show this message
`.trim());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
