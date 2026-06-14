/**
 * Paired per-fixture comparison for the optimize loop. Single 12-fixture runs
 * are noisy and the control arm has swung ~8pp between identical runs, so the
 * keep/discard decision must be *paired* — compare the same fixture's outcome
 * under baseline vs candidate (both measured in the same session), not two
 * aggregate means measured at different times.
 *
 * Consumes two `.records.json` files written by run.ts. Filters to one arm
 * (default hashline) and one model, matches fixtures by name, and reports:
 *   - pass changes: gained / lost / net (McNemar-style discordant pairs)
 *   - edit-failures/task: mean delta + per-fixture deltas
 *   - a KEEP/DISCARD verdict under the loop rule, honoring a noise margin.
 *
 * Usage:
 *   bun run bench/paired.ts <baseline.records.json> <candidate.records.json> \
 *     [--model claude-sonnet-4-6] [--arm hashline] [--margin 1]
 *
 * The `--margin` is the minimum net pass-fixtures swing (count, not rate) below
 * which a pass change is treated as noise rather than signal. Default 1 means
 * "a single flipped fixture is not enough to claim a pass regression"; the rule
 * still keeps only when edit-fails strictly improve.
 */
import { readFileSync } from "node:fs";
import type { RunRecord } from "./score.ts";

interface RecordsFile {
  corpusPin?: string;
  formatterId?: string;
  records: RunRecord[];
}

function arg(name: string, fallback?: string): string | undefined {
  const i = Bun.argv.indexOf(name);
  return i > -1 ? Bun.argv[i + 1] : fallback;
}

function load(p: string): RecordsFile {
  return JSON.parse(readFileSync(p, "utf8")) as RecordsFile;
}

function index(file: RecordsFile, model: string, arm: string): Map<string, RunRecord> {
  const m = new Map<string, RunRecord>();
  for (const r of file.records) {
    if (r.model === model && r.arm === arm) m.set(r.fixture, r);
  }
  return m;
}

function main() {
  const basePath = Bun.argv[2];
  const candPath = Bun.argv[3];
  if (!basePath || !candPath || basePath.startsWith("--") || candPath.startsWith("--")) {
    console.error("usage: bun run bench/paired.ts <baseline.records.json> <candidate.records.json> [--model M] [--arm hashline] [--margin 1]");
    process.exit(2);
  }
  const model = arg("--model", "claude-sonnet-4-6") as string;
  const arm = arg("--arm", "hashline") as string;
  const margin = Number(arg("--margin", "1"));

  const base = index(load(basePath), model, arm);
  const cand = index(load(candPath), model, arm);
  const fixtures = [...base.keys()].filter(f => cand.has(f)).sort();

  if (fixtures.length === 0) {
    console.error(`No overlapping fixtures for model=${model} arm=${arm}. Check the files.`);
    process.exit(2);
  }

  let gained = 0; // failed in base, passed in candidate
  let lost = 0; // passed in base, failed in candidate
  let editFailDeltaSum = 0;
  let tokenDeltaSum = 0;
  const rows: string[] = [];
  for (const fx of fixtures) {
    const b = base.get(fx)!;
    const c = cand.get(fx)!;
    if (!b.pass && c.pass) gained++;
    if (b.pass && !c.pass) lost++;
    const efΔ = c.rejections - b.rejections;
    const tokΔ = c.outputTokens - b.outputTokens;
    editFailDeltaSum += efΔ;
    tokenDeltaSum += tokΔ;
    const flip = !b.pass && c.pass ? "▲pass" : b.pass && !c.pass ? "▼FAIL" : "  =  ";
    rows.push(
      `  ${fx.padEnd(28)} ${flip}  editfail ${String(b.rejections).padStart(2)}→${String(c.rejections).padStart(2)} (${fmtDelta(efΔ)})  tok ${fmtDelta(tokΔ)}`,
    );
  }

  const n = fixtures.length;
  const netPass = gained - lost;
  const meanEditFailDelta = editFailDeltaSum / n;
  const meanTokenDelta = tokenDeltaSum / n;

  // Keep/discard under the loop rule, with the pass guardrail honoring a noise
  // margin: a net pass loss within the margin is treated as noise (not a
  // regression), but any net loss beyond it blocks the keep regardless of
  // edit-fail gains. Edit-fails must strictly improve to keep.
  const passRegressed = netPass < 0 && Math.abs(netPass) >= margin;
  const editFailImproved = meanEditFailDelta < 0;
  const editFailTied = meanEditFailDelta === 0;
  let verdict: string;
  if (passRegressed) {
    verdict = `DISCARD — pass regressed by ${Math.abs(netPass)} fixture(s) (≥ margin ${margin})`;
  } else if (editFailImproved) {
    verdict = `KEEP — edit-fails/task improved by ${(-meanEditFailDelta).toFixed(2)}, pass within margin`;
  } else if (editFailTied && meanTokenDelta < 0) {
    verdict = `KEEP (tie-break) — edit-fails flat, tokens down ${(-meanTokenDelta).toFixed(0)}/task`;
  } else {
    verdict = `DISCARD — edit-fails did not improve (Δ ${fmtDelta(meanEditFailDelta)})`;
  }

  console.log(`Paired comparison · model=${model} arm=${arm} · n=${n} fixtures`);
  console.log(`  baseline:  ${basePath}`);
  console.log(`  candidate: ${candPath}`);
  console.log("");
  console.log(rows.join("\n"));
  console.log("");
  console.log(`  pass: +${gained} gained / -${lost} lost  →  net ${fmtDelta(netPass)} fixture(s)  (margin ${margin})`);
  console.log(`  edit-fails/task: mean Δ ${fmtDelta(meanEditFailDelta, 2)}`);
  console.log(`  tokens/task:     mean Δ ${fmtDelta(meanTokenDelta, 0)}`);
  console.log("");
  console.log(`  VERDICT: ${verdict}`);
}

function fmtDelta(x: number, digits = 0): string {
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : s;
}

main();
