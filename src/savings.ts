/**
 * Live token-savings tracker. Every successful hashline edit avoids a full-file
 * Write: a Write would have re-emitted the entire post-edit file (`after`), but
 * hashline only emits the patch the model typed (`input`). The per-call saving
 * is therefore est(after) - est(input), accumulated into a per-project,
 * append-only JSONL ledger so a running "saved so far" total survives across
 * sessions (each Claude Code session is its own server process).
 *
 * IMPORTANT: token counts here are an ESTIMATE (chars/4). Anthropic ships no
 * exact local tokenizer for current Claude models, and the only ground truth is
 * the count_tokens API / real-call usage fields -- neither fits a synchronous,
 * offline edit path. The package's own `Tokenizer` is a patch-grammar lexer,
 * NOT an LLM token counter, so it is deliberately not used. Treat every number
 * as directional, not billable.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalize } from "./jailed-fs.ts";

/** chars/4 heuristic. Deliberately approximate; see the file header. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Tracking is ON by default; opt out with HASHLINE_TRACK_SAVINGS in
 * {"0","false","off","no"} (case-insensitive). Mirrors the forgiving env style
 * used elsewhere, but inverted: a bare unset means enabled.
 */
export function trackingEnabled(): boolean {
  const v = process.env.HASHLINE_TRACK_SAVINGS;
  if (v === undefined) return true;
  const t = v.trim().toLowerCase();
  return t !== "0" && t !== "false" && t !== "off" && t !== "no";
}

/** Directory holding per-project ledgers (override with HASHLINE_SAVINGS_DIR). */
export function savingsDir(): string {
  if (process.env.HASHLINE_SAVINGS_DIR) return path.resolve(process.env.HASHLINE_SAVINGS_DIR);
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return path.join(configDir, "hashline-savings");
}

/**
 * Stable, readable ledger filename for a project root: `<basename>-<hash8>.jsonl`.
 * The hash disambiguates same-named projects in different paths; the basename
 * keeps the file human-identifiable. Lives outside the repo (under the Claude
 * config dir) so it never pollutes the tree or needs gitignoring.
 */
export function ledgerPathFor(root: string): string {
  // Canonicalize exactly as the jail keys `ctx.root` (resolve + realpath), so a
  // CLI/read by a symlinked path lands on the same ledger the server wrote.
  const abs = canonicalize(path.resolve(root));
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 8);
  const base = path.basename(abs).replace(/[^A-Za-z0-9._-]/g, "_") || "root";
  return path.join(savingsDir(), `${base}-${hash}.jsonl`);
}

export interface EditSaving {
  /** Number of changed (non-noop) sections in the edit call. */
  sections: number;
  /** est tokens for the str_replace counterfactual (sum of changed old+new text). */
  baselineTokens: number;
  /**
   * est tokens hashline actually emitted: the whole `input` the model typed,
   * INCLUDING the `[path#tag]` header and op lines. That framing is real output,
   * so a tiny edit can net ~0 or slightly negative — the win concentrates in
   * large edits where str_replace would have to reproduce a big `old_string`.
   */
  patchTokens: number;
  /** baselineTokens - patchTokens (can be <= 0 for tiny edits and for creates). */
  savedTokens: number;
}

/** Pre/post text of one changed section, as exposed by the patch engine's result. */
export interface ChangedSection {
  before: string;
  after: string;
}

/**
 * Estimate what `str_replace` would have emitted for one section: `old_string`
 * plus `new_string`. The realistic built-in alternative to a hashline edit is a
 * str_replace, not a full-file Write, so the counterfactual is the changed
 * region on each side — isolated by trimming the common leading/trailing lines
 * of `before` vs `after`. Contiguous and dependency-free, which suffices because
 * hashline ops target contiguous ranges. A multi-hunk edit collapses to the one
 * span covering all hunks, slightly overcounting — directional, acceptable, and
 * cheaper than pulling in a real diff. A create (`before === ""`) yields the
 * whole body, matching str_replace's only create-counterfactual (a Write).
 */
export function strReplaceTokens(before: string, after: string): number {
  const b = before.split("\n");
  const a = after.split("\n");
  let p = 0;
  while (p < b.length && p < a.length && b[p] === a[p]) p++;
  let s = 0;
  while (s < b.length - p && s < a.length - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s++;
  const oldChanged = b.slice(p, b.length - s).join("\n");
  const newChanged = a.slice(p, a.length - s).join("\n");
  return estimateTokens(oldChanged) + estimateTokens(newChanged);
}

interface LedgerRow extends EditSaving {
  v: 2;
  ts: number;
}

/**
 * Append one edit call's saving to the project ledger. NEVER throws: tracking is
 * a side metric and must not break an edit. Returns the computed saving, or null
 * when tracking is disabled or nothing changed. `sections` carries the pre/post
 * text of each changed section (from the patch result); `input` is the raw patch
 * the model emitted. The saving is measured against the str_replace
 * counterfactual, NOT a full-file Write.
 */
export function recordEditSaving(root: string, input: string, sections: ChangedSection[]): EditSaving | null {
  if (!trackingEnabled() || sections.length === 0) return null;
  const baselineTokens = sections.reduce((sum, s) => sum + strReplaceTokens(s.before, s.after), 0);
  const patchTokens = estimateTokens(input);
  const saving: EditSaving = {
    sections: sections.length,
    baselineTokens,
    patchTokens,
    savedTokens: baselineTokens - patchTokens,
  };
  try {
    const file = ledgerPathFor(root);
    mkdirSync(path.dirname(file), { recursive: true });
    const row: LedgerRow = { v: 2, ts: Date.now(), ...saving };
    // O_APPEND keeps tiny JSON lines atomic across concurrent session processes.
    appendFileSync(file, JSON.stringify(row) + "\n");
  } catch {
    // Ledger write failures are non-fatal by design.
  }
  return saving;
}

/** One baseline's accumulated totals. */
export interface RollupAcc {
  edits: number;
  baselineTokens: number;
  patchTokens: number;
  savedTokens: number;
}

/**
 * The project ledger summed and split by baseline. `current` holds v2 rows (the
 * honest str_replace baseline); `legacy` holds v1 rows (the old, inflated
 * full-Write baseline). v1 rows stored only counts and no before-text, so they
 * cannot be recomputed — they are reported separately and never folded into the
 * current total.
 */
export interface Rollup {
  current: RollupAcc;
  legacy: RollupAcc;
}

function emptyAcc(): RollupAcc {
  return { edits: 0, baselineTokens: 0, patchTokens: 0, savedTokens: 0 };
}

/** Sum the project ledger. Missing/empty ledger -> all zeros; bad lines skipped. */
export function readRollup(root: string): Rollup {
  const rollup: Rollup = { current: emptyAcc(), legacy: emptyAcc() };
  let text: string;
  try {
    text = readFileSync(ledgerPathFor(root), "utf8");
  } catch {
    return rollup;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (typeof row.savedTokens !== "number") continue;
      const acc = row.v === 2 ? rollup.current : rollup.legacy;
      // v2 rows carry baselineTokens; legacy v1 rows carry fullWriteTokens.
      const baseline =
        typeof row.baselineTokens === "number" ? row.baselineTokens
        : typeof row.fullWriteTokens === "number" ? row.fullWriteTokens
        : 0;
      acc.edits += 1;
      acc.baselineTokens += baseline;
      acc.patchTokens += typeof row.patchTokens === "number" ? row.patchTokens : 0;
      acc.savedTokens += row.savedTokens;
    } catch {
      // Skip a malformed line rather than abort the whole rollup.
    }
  }
  return rollup;
}

/** Human-readable summary for the CLI / slash command. */
export function formatRollup(root: string, r: Rollup): string {
  const n = (x: number) => Math.round(x).toLocaleString("en-US");
  const cur = r.current;
  const pct = cur.baselineTokens > 0 ? (cur.savedTokens / cur.baselineTokens) * 100 : 0;
  const lines = [
    `Hashline token savings (estimated, chars/4) -- ${root}`,
    `  Edits tracked:     ${n(cur.edits)}`,
    `  str_replace cost:  ${n(cur.baselineTokens)}  (what the built-in editor would have emitted)`,
    `  Hashline cost:     ${n(cur.patchTokens)}  (what hashline actually emitted)`,
    `  Estimated saved:   ${n(cur.savedTokens)}  (~${pct.toFixed(0)}% fewer output tokens)`,
  ];
  if (r.legacy.edits > 0) {
    lines.push(
      `  Legacy rows:       ${n(r.legacy.edits)} edit(s), ${n(r.legacy.savedTokens)} "saved" on the old full-Write baseline -- inflated and not comparable; excluded from the total above.`,
    );
  }
  lines.push(
    `Benchmark-calibrated: hashline's measured real-world savings are 9-21% (docs/benchmark/analysis.md); a far larger figure means the baseline is wrong.`,
    `Estimate only -- Claude has no exact local tokenizer; treat as directional.`,
  );
  return lines.join("\n");
}

// CLI entry: `bun run src/savings.ts [root]` prints the current project rollup.
if (import.meta.main) {
  const root = path.resolve(process.argv[2] ?? process.env.HASHLINE_ROOT ?? process.cwd());
  console.log(formatRollup(root, readRollup(root)));
}
