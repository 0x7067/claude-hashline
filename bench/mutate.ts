/**
 * Reversible mechanical mutations on real source files (R10). Each mutation is
 * a single, inverse-known change framed as a bug; the pre-mutation original is
 * the ground-truth fix. Fixtures are tagged with a difficulty class so an
 * easy-task null is not read as an overall null (adv-08):
 *  - "simple"      — single-site, unambiguous anchor
 *  - "hard-anchor" — the mutated line's text also occurs elsewhere in the file,
 *                    the duplicate/ambiguous case where str_replace anchoring
 *                    fails and hashline should win.
 *  - "multi-edit"  — two independent single-site bugs in one file; fixing it
 *                    needs two sequential edits (exercises chained-edit reuse).
 */
export type Difficulty = "simple" | "hard-anchor" | "multi-edit";

export interface Mutation {
  /** Stable id of the mutation kind. */
  kind: string;
  /** The file with the bug introduced. */
  buggy: string;
  /** Plain-English description of the bug to fix. */
  description: string;
  difficulty: Difficulty;
  /** 1-indexed line that was mutated. */
  line: number;
}

interface Rule {
  kind: string;
  /** Regex matching a mutatable token on a line, with the replacement. */
  find: RegExp;
  replace: string;
  describe: string;
}

// Each rule swaps a token for its semantic opposite. Applying the rule once
// introduces the bug; the original line is the fix.
const RULES: Rule[] = [
  { kind: "operator-eq", find: /===/, replace: "!==", describe: "An equality check was inverted (=== became !==). Restore the correct comparison." },
  { kind: "operator-rel", find: /<=/, replace: "<", describe: "A comparison lost its equals (<= became <), an off-by-one. Restore <=." },
  { kind: "boolean-flip", find: /\btrue\b/, replace: "false", describe: "A boolean literal was flipped from true to false. Restore it." },
  { kind: "operator-add", find: /\+/, replace: "-", describe: "An arithmetic operator was changed (+ became -). Restore the addition." },
];

const GUARD_RE = /^\s*if\s*\(.*\)\s*return[^;]*;\s*$/;

function lineOccursMoreThanOnce(lines: string[], idx: number): boolean {
  const target = lines[idx];
  return lines.filter(l => l === target).length > 1;
}

/**
 * Blank out the non-code regions of each line — block comments (stateful across
 * lines), line comments, and string/template literals — preserving length and
 * column positions. Operator rules are matched against this masked view so a
 * token like `+` inside a comment or string is never selected as a "bug"
 * (otherwise the task describes arithmetic that doesn't exist; see fixture
 * 0007-operator-add). Block-comment state carries across lines; string state
 * does not (multi-line templates are treated conservatively as code).
 */
function maskNonCode(lines: string[]): string[] {
  const masked: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    let out = "";
    let i = 0;
    let inStr: string | null = null;
    while (i < raw.length) {
      const two = raw.slice(i, i + 2);
      const c = raw[i];
      if (inBlock) {
        if (two === "*/") { out += "  "; i += 2; inBlock = false; }
        else { out += " "; i += 1; }
      } else if (inStr) {
        if (c === "\\") { out += "  "; i += 2; }
        else if (c === inStr) { out += " "; i += 1; inStr = null; }
        else { out += " "; i += 1; }
      } else if (two === "/*") {
        out += "  "; i += 2; inBlock = true;
      } else if (two === "//") {
        out += " ".repeat(raw.length - i); break;
      } else if (c === '"' || c === "'" || c === "`") {
        out += " "; i += 1; inStr = c;
      } else {
        out += c; i += 1;
      }
    }
    masked.push(out);
  }
  return masked;
}

/** All single-site mutations applicable to `source`, across rule + guard kinds. */
export function mutationsFor(source: string): Mutation[] {
  const lines = source.split("\n");
  const masked = maskNonCode(lines);
  const out: Mutation[] = [];
  const singleSites: { line: number; mutatedLine: string; describe: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      // Match against the masked view so comment/string tokens are skipped,
      // but apply the replacement at that exact index in the real line.
      const m = rule.find.exec(masked[i]);
      if (!m) continue;
      const idx = m.index;
      const mutatedLine = line.slice(0, idx) + line.slice(idx).replace(rule.find, rule.replace);
      if (mutatedLine === line) continue;
      const buggyLines = [...lines];
      buggyLines[i] = mutatedLine;
      out.push({
        kind: rule.kind,
        buggy: buggyLines.join("\n"),
        description: `# Fix the bug\n\n${rule.describe}\nThe issue is on or near line ${i + 1}.`,
        difficulty: lineOccursMoreThanOnce(lines, i) ? "hard-anchor" : "simple",
        line: i + 1,
      });
      singleSites.push({ line: i + 1, mutatedLine, describe: rule.describe });
    }
    if (GUARD_RE.test(line)) {
      const buggyLines = lines.filter((_, j) => j !== i);
      out.push({
        kind: "removed-guard",
        buggy: buggyLines.join("\n"),
        description: `# Fix the bug\n\nA guard clause (an early-return if-statement) was removed near line ${i + 1}. Restore it.`,
        difficulty: lineOccursMoreThanOnce(lines, i) ? "hard-anchor" : "simple",
        line: i + 1,
      });
    }
  }
  // Multi-edit fixture (R6): compose the first two non-overlapping single-site
  // operator edits into ONE buggy file so the fix needs two sequential edits.
  // meta.line is the first site; these are hashline-arm only (search-mode
  // assumes a single anchor line).
  const distinct = singleSites.filter((s, i) => singleSites.findIndex(o => o.line === s.line) === i);
  if (distinct.length >= 2) {
    const [a, b] = distinct;
    const buggyLines = [...lines];
    buggyLines[a.line - 1] = a.mutatedLine;
    buggyLines[b.line - 1] = b.mutatedLine;
    out.push({
      kind: "multi-edit",
      buggy: buggyLines.join("\n"),
      description: `# Fix the bugs\n\nThis file has TWO separate bugs. Fix both:\n1. Near line ${a.line}: ${a.describe}\n2. Near line ${b.line}: ${b.describe}`,
      difficulty: "multi-edit",
      line: a.line,
    });
  }
  return out;
}
