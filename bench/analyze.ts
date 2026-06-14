/**
 * Benchmark report analyzer. Reads a rendered `report.md` (the aggregate table
 * produced by bench/run.ts), computes hashline-vs-control deltas, optionally
 * classifies the hashline arm's edit-failures from persisted transcripts, then:
 *   - prints a compact ASCII summary + key takeaways to stdout (for the terminal)
 *   - writes a full markdown analysis to --out
 *
 * Usage:
 *   bun run bench/analyze.ts [report.md] [--out <file>] [--classify <root-token>]
 *
 * --classify <token> scans ~/.claude/projects for transcript dirs whose name
 * contains <token> (the sweep's temp-workspace parent, e.g. hashline-bench-XXXX)
 * and breaks the hashline arm's errored tool_results into: blocked-built-in
 * (familiarity reflex), genuine hashline rejection, and other. If omitted, the
 * most recent hashline-bench-* root is auto-detected; pass `none` to skip.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

function arg(name: string): string | undefined {
  const i = Bun.argv.indexOf(name);
  return i > -1 ? Bun.argv[i + 1] : undefined;
}

const shortModel = (m: string) => m.replace(/^claude-/, "").replace(/-\d.*$/, "");

interface Cell {
  model: string;
  arm: string;
  difficulty: string;
  n: number;
  pass: number; // 0..1
  editFail: number;
  tokens: number;
  turns: number;
  masked: number;
}

interface ParsedReport {
  cells: Cell[];
  formatter: string;
  corpusPin: string;
  models: string;
}

function parseReport(md: string): ParsedReport {
  const lines = md.split("\n");
  const meta = (label: string) => {
    const line = lines.find(l => l.startsWith(`- ${label}`));
    return line ? line.slice(label.length + 2).replace(/`/g, "").trim() : "unknown";
  };
  const cells: Cell[] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("| ")) continue;
    const c = line.split("|").map(s => s.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (c.length !== 9) continue;
    if (c[0] === "model" || c[0].startsWith("--")) continue;
    cells.push({
      model: c[0], arm: c[1], difficulty: c[2], n: Number(c[3]),
      pass: Number(c[4].replace("%", "")) / 100, editFail: Number(c[5]),
      tokens: Number(c[6]), turns: Number(c[7]), masked: Number(c[8]),
    });
  }
  return { cells, formatter: meta("Formatter (pinned):"), corpusPin: meta("Corpus pin:"), models: meta("Models:") };
}

/** Minimal ASCII table renderer (+, -, | borders). */
function asciiTable(headers: string[], rows: string[][]): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)));
  const sep = "+" + w.map(x => "-".repeat(x + 2)).join("+") + "+";
  const fmt = (cells: string[]) => "| " + cells.map((c, i) => (c ?? "").padEnd(w[i])).join(" | ") + " |";
  return [sep, fmt(headers), sep, ...rows.map(fmt), sep].join("\n");
}

interface Delta { model: string; difficulty: string; dPass: number; tokenRatio: number; dTurns: number; dEditFail: number; }

function deltas(cells: Cell[]): Delta[] {
  const out: Delta[] = [];
  const get = (m: string, a: string, d: string) => cells.find(c => c.model === m && c.arm === a && c.difficulty === d);
  const models = [...new Set(cells.map(c => c.model))];
  const diffs = [...new Set(cells.map(c => c.difficulty))];
  for (const m of models) for (const d of diffs) {
    const h = get(m, "hashline", d), ctl = get(m, "control", d);
    if (!h || !ctl) continue;
    out.push({
      model: m, difficulty: d,
      dPass: h.pass - ctl.pass,
      tokenRatio: ctl.tokens ? h.tokens / ctl.tokens : NaN,
      dTurns: h.turns - ctl.turns,
      dEditFail: h.editFail - ctl.editFail,
    });
  }
  return out;
}

// ---- optional transcript classification of hashline-arm edit failures ----
interface Classification { sessions: number; total: number; blocked: number; reject: number; pathBug: number; other: number; }

function autoDetectRoot(proj: string): string | undefined {
  try {
    const cands = readdirSync(proj).filter(d => d.includes("hashline-bench-"));
    const token = (d: string) => d.match(/hashline-bench-[A-Za-z0-9]+/)?.[0];
    const tokens = [...new Set(cands.map(token).filter(Boolean) as string[])];
    let best: { t: string; m: number } | undefined;
    for (const t of tokens) {
      const dir = cands.find(d => d.includes(t))!;
      const m = statSync(path.join(proj, dir)).mtimeMs;
      if (!best || m > best.m) best = { t, m };
    }
    return best?.t;
  } catch { return undefined; }
}

function classify(rootToken: string): Classification | undefined {
  const proj = path.join(homedir(), ".claude", "projects");
  let dirs: string[];
  try { dirs = readdirSync(proj).filter(d => d.includes(rootToken) && /--hashline$/.test(d)); }
  catch { return undefined; }
  if (!dirs.length) return undefined;
  const c: Classification = { sessions: dirs.length, total: 0, blocked: 0, reject: 0, pathBug: 0, other: 0 };
  for (const d of dirs) {
    const full = path.join(proj, d);
    const jf = readdirSync(full).find(f => f.endsWith(".jsonl"));
    if (!jf) continue;
    const tn: Record<string, string> = {};
    for (const l of readFileSync(path.join(full, jf), "utf8").trim().split("\n")) {
      let o: any; try { o = JSON.parse(l); } catch { continue; }
      const content = o?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const x of content) {
        if (x.type === "tool_use") tn[x.id] = x.name;
        if (x.type === "tool_result" && x.is_error) {
          c.total++;
          const name = tn[x.tool_use_id] ?? "";
          const txt = typeof x.content === "string" ? x.content : JSON.stringify(x.content);
          if (/No such tool available|not enabled in this context/.test(txt) || /^(Edit|Write|NotebookEdit)$/.test(name)) c.blocked++;
          else if (/resolves to .* outside the workspace/.test(txt)) c.pathBug++;
          else if (/hashline/.test(name) || /does not match|no hashline read|stale|hunk header|payload line/i.test(txt)) c.reject++;
          else c.other++;
        }
      }
    }
  }
  return c;
}

// ---------------------------- main ----------------------------
const reportPath = (Bun.argv[2] && !Bun.argv[2].startsWith("--")) ? Bun.argv[2] : "report.md";
const outPath = arg("--out") ?? "docs/benchmark/analysis.md";
const md = readFileSync(reportPath, "utf8");
const { cells, formatter, corpusPin, models } = parseReport(md);
if (!cells.length) { console.error(`No table rows parsed from ${reportPath}`); process.exit(1); }

const classifyArg = arg("--classify");
const proj = path.join(homedir(), ".claude", "projects");
const rootToken = classifyArg ?? autoDetectRoot(proj);
const cls = (classifyArg === "none" || !rootToken) ? undefined : classify(rootToken);

// ---- terminal summary (ASCII) ----
const allCells = cells.filter(c => c.difficulty === "all").sort((a, b) => a.model.localeCompare(b.model) || a.arm.localeCompare(b.arm));
const summaryRows = allCells.map(c => [
  shortModel(c.model), c.arm, String(c.n), `${(c.pass * 100).toFixed(0)}%`,
  c.editFail.toFixed(1), Math.round(c.tokens).toString(), c.turns.toFixed(1), String(c.masked),
]);
const dl = deltas(cells).filter(d => d.difficulty === "all");
const deltaRows = dl.map(d => [
  shortModel(d.model),
  `${d.dPass >= 0 ? "+" : ""}${(d.dPass * 100).toFixed(0)}pp`,
  `${d.tokenRatio.toFixed(2)}x`,
  `${d.dTurns >= 0 ? "+" : ""}${d.dTurns.toFixed(1)}`,
  `${d.dEditFail >= 0 ? "+" : ""}${d.dEditFail.toFixed(1)}`,
]);

function takeaways(): string[] {
  const t: string[] = [];
  for (const d of dl) {
    const m = shortModel(d.model);
    const passWord = Math.abs(d.dPass) < 0.001 ? "matched" : d.dPass > 0 ? `won by ${(d.dPass * 100).toFixed(0)}pp` : `lost ${(Math.abs(d.dPass) * 100).toFixed(0)}pp`;
    const tokPct = ((d.tokenRatio - 1) * 100);
    t.push(`${m}: hashline ${passWord} on pass rate; ${tokPct >= 0 ? "+" : ""}${tokPct.toFixed(0)}% tokens, ${d.dTurns >= 0 ? "+" : ""}${d.dTurns.toFixed(1)} turns, ${d.dEditFail >= 0 ? "+" : ""}${d.dEditFail.toFixed(1)} edit-fails/task vs control.`);
  }
  const masked = cells.filter(c => c.arm === "hashline" && c.masked > 0);
  if (masked.length) t.push(`WARNING: ${masked.reduce((a, c) => a + c.masked, 0)} masked pass(es) in the hashline arm — raw whitespace/indent deviations the formatter hid (adv-05).`);
  else t.push(`No masked passes: the formatter oracle hid no whitespace/indent deviations in either arm.`);
  if (cls) {
    const pct = (n: number) => cls.total ? `${((n / cls.total) * 100).toFixed(0)}%` : "0%";
    t.push(`Edit-failure breakdown (hashline arm, ${cls.total} errors over ${cls.sessions} sessions): ${cls.reject} genuine hashline rejections (${pct(cls.reject)}), ${cls.blocked} blocked-built-in reflexes (${pct(cls.blocked)}), ${cls.pathBug} jail path-rejections (${pct(cls.pathBug)}), ${cls.other} other.`);
    if (cls.blocked === 0) t.push(`Familiarity note: 0 blocked-built-in attempts — the model adopted the hashline tools without reaching for str_replace, so the friction is patch CONSTRUCTION, not tool selection.`);
  }
  return t;
}

const tks = takeaways();

const term = [
  "",
  `Hashline benchmark — ${corpusPin}`,
  `Models: ${models}  |  Formatter: ${formatter}`,
  "",
  asciiTable(["model", "arm", "n", "pass", "editfail", "tokens", "turns", "masked"], summaryRows),
  "",
  "hashline vs control (overall):",
  asciiTable(["model", "Δpass", "tokens", "Δturns", "Δeditfail"], deltaRows),
  "",
  "Key takeaways:",
  ...tks.map(t => `  - ${t}`),
  "",
].join("\n");
console.log(term);

// ---- full markdown report ----
const full = [
  "# Hashline benchmark — analysis",
  "",
  `- **Corpus:** \`${corpusPin}\``,
  `- **Models:** ${models}`,
  `- **Formatter (oracle):** \`${formatter}\``,
  `- **Source report:** \`${reportPath}\``,
  cls ? `- **Edit-failure classification root:** \`${rootToken}\`` : "",
  "",
  "## Results (overall + by difficulty)",
  "",
  md.split("\n").filter(l => l.startsWith("|")).join("\n"),
  "",
  "## hashline vs control (overall deltas)",
  "",
  "| model | Δpass | token ratio | Δturns | Δedit-fail/task |",
  "|---|---|---|---|---|",
  ...dl.map(d => `| ${shortModel(d.model)} | ${d.dPass >= 0 ? "+" : ""}${(d.dPass * 100).toFixed(1)}pp | ${d.tokenRatio.toFixed(2)}x | ${d.dTurns >= 0 ? "+" : ""}${d.dTurns.toFixed(1)} | ${d.dEditFail >= 0 ? "+" : ""}${d.dEditFail.toFixed(1)} |`),
  "",
  cls ? "## Edit-failure breakdown (hashline arm, from transcripts)\n\n| category | count | share |\n|---|---|---|\n" +
    `| genuine hashline rejection | ${cls.reject} | ${cls.total ? ((cls.reject / cls.total) * 100).toFixed(0) : 0}% |\n` +
    `| blocked built-in (familiarity reflex) | ${cls.blocked} | ${cls.total ? ((cls.blocked / cls.total) * 100).toFixed(0) : 0}% |\n` +
    `| jail path-rejection | ${cls.pathBug} | ${cls.total ? ((cls.pathBug / cls.total) * 100).toFixed(0) : 0}% |\n` +
    `| other | ${cls.other} | ${cls.total ? ((cls.other / cls.total) * 100).toFixed(0) : 0}% |\n` +
    `\nTotal ${cls.total} errored tool_results across ${cls.sessions} hashline sessions.` : "",
  "",
  "## Key takeaways",
  "",
  ...tks.map(t => `- ${t}`),
  "",
  "## Limitations",
  "",
  "- **Confound (adv-02):** hashline and control differ on two variables — edit format AND Claude's RL-training familiarity with the tooling. A control-favoring result cannot, without a familiarity-control arm, fully separate \"hash format is worse\" from \"Claude is not trained on this patch syntax\".",
  "- **Sample size:** small per-cell n (see table); treat single-fixture difficulty cells (e.g. hard-anchor n=1) as anecdotes, not estimates.",
  "- **Pass oracle:** prettier-normalized equality; the `masked` column flags any raw deviation the formatter hid.",
  "",
].filter(l => l !== "").join("\n");

// ensure out dir exists
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, full + "\n");
console.log(`Full analysis written to ${outPath}`);
