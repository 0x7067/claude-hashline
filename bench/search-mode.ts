/**
 * Search-mode benchmark helpers (plan 003). These turn a single-file "fix the
 * bug in X" fixture into a locate-then-edit task: the target file is hidden among
 * distractors and the prompt withholds the path, pointing instead at a searchable
 * anchor. Pure functions, unit-tested without the `claude` CLI.
 */

/** JS/TS keywords never useful as a search anchor. */
const KEYWORDS = new Set([
  "function", "const", "let", "var", "class", "return", "if", "else", "for",
  "while", "switch", "case", "break", "continue", "new", "this", "true", "false",
  "null", "undefined", "void", "typeof", "import", "export", "default", "from",
  "async", "await", "yield", "extends", "implements", "interface", "type", "enum",
]);

const DECL_RE = /\b(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

/** Longest non-keyword identifier (≥4 chars) on a line, or "". */
function longestIdent(line: string): string {
  let best = "";
  for (const m of line.match(IDENT_RE) ?? []) {
    if (m.length >= 4 && !KEYWORDS.has(m) && m.length > best.length) best = m;
  }
  return best;
}

/**
 * Derive a search anchor from the expected (correct) file: a stable identifier at
 * or just above the mutated line that the model can grep to locate the file.
 * Prefers a declaration name; falls back to the longest identifier in the window.
 */
export function computeAnchor(expected: string, line: number): string {
  const lines = expected.split("\n");
  const idx = Math.min(Math.max(line - 1, 0), lines.length - 1);
  // Bias slightly above the mutated line (a removed guard line may itself be gone
  // in the buggy file, but declarations above it are stable).
  for (let i = idx; i >= Math.max(0, idx - 4); i--) {
    const decl = DECL_RE.exec(lines[i] ?? "");
    if (decl?.[1] && decl[1].length >= 3 && !KEYWORDS.has(decl[1])) return decl[1];
  }
  for (let i = idx; i >= Math.max(0, idx - 4); i--) {
    const id = longestIdent(lines[i] ?? "");
    if (id) return id;
  }
  return longestIdent(lines[idx] ?? "") || "the bug";
}

/**
 * Rewrite a fixture task into a search-mode prompt: strip the filename and line
 * hints, prepend the multi-file locate instruction, append the anchor hint.
 */
export function buildSearchPrompt(task: string, anchor: string): string {
  const cleaned = task
    .split("\n")
    .filter(l => !/^\s*File:/i.test(l))
    .map(l => l.replace(/\s*The issue is on or near line \d+\.?/i, "").replace(/\s*\(?near line \d+\)?\.?/i, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [
    "# Fix the bug",
    "",
    "This workspace contains several source files. Exactly one of them has the bug",
    "described below. Do NOT assume a filename — search the workspace to locate the",
    "file first, then fix it.",
    "",
    cleaned.replace(/^#.*\n?/, "").trim(),
    "",
    `Search hint: the buggy code is in the file that defines or uses \`${anchor}\`.`,
  ].join("\n");
}

export interface DistractorFile {
  name: string;
  content: string;
}

/**
 * Choose up to `k` distractor files from other fixtures: dedup by name, drop any
 * whose name collides with the target or whose content contains the anchor (so
 * the anchor stays a unique locator). Deterministic given input order.
 */
export function pickDistractors(
  others: DistractorFile[],
  k: number,
  anchor: string,
  targetName: string,
): DistractorFile[] {
  const out: DistractorFile[] = [];
  const seen = new Set<string>([targetName]);
  for (const f of others) {
    if (out.length >= k) break;
    if (seen.has(f.name)) continue;
    if (f.content.includes(anchor)) continue;
    seen.add(f.name);
    out.push(f);
  }
  return out;
}
