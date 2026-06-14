/**
 * Reversible mechanical mutations on real source files (R10). Each mutation is
 * a single, inverse-known change framed as a bug; the pre-mutation original is
 * the ground-truth fix. Fixtures are tagged with a difficulty class so an
 * easy-task null is not read as an overall null (adv-08):
 *  - "simple"      — single-site, unambiguous anchor
 *  - "hard-anchor" — the mutated line's text also occurs elsewhere in the file,
 *                    the duplicate/ambiguous case where str_replace anchoring
 *                    fails and hashline should win.
 */
export type Difficulty = "simple" | "hard-anchor";

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

/** All single-site mutations applicable to `source`, across rule + guard kinds. */
export function mutationsFor(source: string): Mutation[] {
  const lines = source.split("\n");
  const out: Mutation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (!rule.find.test(line)) continue;
      const mutatedLine = line.replace(rule.find, rule.replace);
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
  return out;
}
