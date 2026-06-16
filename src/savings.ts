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
  /** est tokens for the full-file Write counterfactual (sum of changed `after`). */
  fullWriteTokens: number;
  /** est tokens the hashline patch actually emitted (the whole `input`). */
  patchTokens: number;
  /** fullWriteTokens - patchTokens (<= 0 for creates / whole-file rewrites). */
  savedTokens: number;
}

interface LedgerRow extends EditSaving {
  v: 1;
  ts: number;
}

/**
 * Append one edit call's saving to the project ledger. NEVER throws: tracking is
 * a side metric and must not break an edit. Returns the computed saving, or null
 * when tracking is disabled or nothing changed. `afters` is the post-edit text
 * of each changed section; `input` is the raw patch the model emitted.
 */
export function recordEditSaving(root: string, input: string, afters: string[]): EditSaving | null {
  if (!trackingEnabled() || afters.length === 0) return null;
  const fullWriteTokens = afters.reduce((sum, a) => sum + estimateTokens(a), 0);
  const patchTokens = estimateTokens(input);
  const saving: EditSaving = {
    sections: afters.length,
    fullWriteTokens,
    patchTokens,
    savedTokens: fullWriteTokens - patchTokens,
  };
  try {
    const file = ledgerPathFor(root);
    mkdirSync(path.dirname(file), { recursive: true });
    const row: LedgerRow = { v: 1, ts: Date.now(), ...saving };
    // O_APPEND keeps tiny JSON lines atomic across concurrent session processes.
    appendFileSync(file, JSON.stringify(row) + "\n");
  } catch {
    // Ledger write failures are non-fatal by design.
  }
  return saving;
}

export interface Rollup {
  edits: number;
  fullWriteTokens: number;
  patchTokens: number;
  savedTokens: number;
}

/** Sum the project ledger. Missing/empty ledger -> all zeros; bad lines skipped. */
export function readRollup(root: string): Rollup {
  const acc: Rollup = { edits: 0, fullWriteTokens: 0, patchTokens: 0, savedTokens: 0 };
  let text: string;
  try {
    text = readFileSync(ledgerPathFor(root), "utf8");
  } catch {
    return acc;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<LedgerRow>;
      if (typeof row.savedTokens !== "number") continue;
      acc.edits += 1;
      acc.fullWriteTokens += row.fullWriteTokens ?? 0;
      acc.patchTokens += row.patchTokens ?? 0;
      acc.savedTokens += row.savedTokens;
    } catch {
      // Skip a malformed line rather than abort the whole rollup.
    }
  }
  return acc;
}

/** Human-readable summary for the CLI / slash command. */
export function formatRollup(root: string, r: Rollup): string {
  const pct = r.fullWriteTokens > 0 ? (r.savedTokens / r.fullWriteTokens) * 100 : 0;
  const n = (x: number) => Math.round(x).toLocaleString("en-US");
  return [
    `Hashline token savings (estimated, chars/4) -- ${root}`,
    `  Edits tracked:     ${n(r.edits)}`,
    `  Full-write tokens: ${n(r.fullWriteTokens)}  (what Write would have emitted)`,
    `  Hashline tokens:   ${n(r.patchTokens)}  (what hashline actually emitted)`,
    `  Estimated saved:   ${n(r.savedTokens)}  (~${pct.toFixed(0)}% fewer output tokens)`,
    `Estimate only -- Claude has no exact local tokenizer; treat as directional.`,
  ].join("\n");
}

// CLI entry: `bun run src/savings.ts [root]` prints the current project rollup.
if (import.meta.main) {
  const root = path.resolve(process.argv[2] ?? process.env.HASHLINE_ROOT ?? process.cwd());
  console.log(formatRollup(root, readRollup(root)));
}
