/**
 * Benchmark runner CLI (R11–R15). For each fixture × arm × model, runs the
 * task headless in an isolated temp workspace under one parent root (no escape-
 * hatch sentinel present, so the hashline arm genuinely blocks built-ins),
 * scores the result, and writes a stratified comparison report.
 *
 * Usage:
 *   bun run bench/run.ts <fixtures-dir> --models m1,m2 [--arms hashline,control]
 *                        [--max-turns 30] [--out report.md]
 *
 * Requires `claude-p` on PATH. Runner failures are recorded, not fatal.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { renderReport } from "./report.ts";
import { aggregate, type RunRecord, scoreFixture } from "./score.ts";
import { type Arm, disallowedToolsFor, parseTranscript, runClaudeP } from "./runner.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = Bun.argv.indexOf(name);
  return i > -1 ? Bun.argv[i + 1] : fallback;
}

interface Fixture {
  dir: string;
  targetName: string;
  difficulty: string;
  task: string;
  buggy: string;
  expected: string;
}

function loadFixtures(dir: string): Fixture[] {
  const out: Fixture[] = [];
  for (const entry of readdirSync(dir)) {
    const fdir = path.join(dir, entry);
    const metaPath = path.join(fdir, "meta.json");
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      out.push({
        dir: fdir,
        targetName: meta.targetName,
        difficulty: meta.difficulty,
        task: readFileSync(path.join(fdir, "task.md"), "utf8"),
        buggy: readFileSync(path.join(fdir, meta.targetName), "utf8"),
        expected: readFileSync(path.join(fdir, `${meta.targetName}.expected`), "utf8"),
      });
    } catch {
      // not a fixture dir
    }
  }
  return out;
}

async function main() {
  const fixturesDir = Bun.argv[2];
  if (!fixturesDir || fixturesDir.startsWith("--")) {
    console.error("usage: bun run bench/run.ts <fixtures-dir> --models m1,m2 [--arms hashline,control] [--max-turns 30] [--out report.md]");
    process.exit(2);
  }
  const models = (arg("--models") ?? "").split(",").filter(Boolean);
  if (models.length === 0) {
    console.error("at least one --models value is required (e.g. --models claude-haiku-4-5,claude-sonnet-4-6)");
    process.exit(2);
  }
  const arms = (arg("--arms", "hashline,control") as string).split(",").filter(Boolean) as Arm[];
  const maxTurns = Number(arg("--max-turns", "30"));
  const outPath = arg("--out");

  const manifest = (() => {
    try {
      return JSON.parse(readFileSync(path.join(fixturesDir, "manifest.json"), "utf8"));
    } catch {
      return { corpusPin: "unknown" };
    }
  })();

  const fixtures = loadFixtures(fixturesDir);
  const parentRoot = mkdtempSync(path.join(tmpdir(), "hashline-bench-"));
  const records: RunRecord[] = [];
  let unavailable = 0;

  try {
    for (const fx of fixtures) {
      for (const model of models) {
        for (const arm of arms) {
          const ws = path.join(parentRoot, `${path.basename(fx.dir)}--${model}--${arm}`);
          mkdirSync(ws, { recursive: true });
          writeFileSync(path.join(ws, fx.targetName), fx.buggy);

          const res = await runClaudeP({
            cwd: ws,
            model,
            maxTurns,
            disallowedTools: disallowedToolsFor(arm),
            prompt: fx.task,
          });
          if (res.unavailable) unavailable++;

          const postEdit = (() => {
            try {
              return readFileSync(path.join(ws, fx.targetName), "utf8");
            } catch {
              return fx.buggy;
            }
          })();
          const score = scoreFixture({ postEdit, expected: fx.expected });
          const metrics = parseTranscript(res.transcript);
          records.push({
            model,
            arm,
            difficulty: fx.difficulty,
            pass: score.pass && !res.unavailable,
            passedOnlyAfterFormat: score.passedOnlyAfterFormat,
            outputTokens: metrics.outputTokens,
            rejections: metrics.rejections,
            turns: metrics.turns,
          });
          rmSync(ws, { recursive: true, force: true });
        }
      }
    }
  } finally {
    rmSync(parentRoot, { recursive: true, force: true });
  }

  if (unavailable > 0) {
    console.error(`WARNING: claude-p was unavailable for ${unavailable} run(s); those are recorded as failures. Install claude-p or wire the claude -p / SDK fallback in runner.ts.`);
  }

  const report = renderReport(aggregate(records), {
    formatterId: "deterministic-normalize@0.1 (placeholder; pin a real formatter)",
    corpusPin: manifest.corpusPin ?? "unknown",
    models,
    ranFamiliarityArm: arms.includes("familiarity"),
  });
  if (outPath) {
    writeFileSync(outPath, report);
    console.log(`Report written to ${outPath}`);
  } else {
    console.log(report);
  }
}

main();
