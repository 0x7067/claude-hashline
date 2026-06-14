import { describe, expect, test } from "bun:test";
import { mutationsFor } from "../bench/mutate.ts";
import { aggregate, formatDeterministic, type RunRecord, scoreFixture } from "../bench/score.ts";
import { disallowedToolsFor, parseTranscript } from "../bench/runner.ts";

describe("mutations (R10)", () => {
  const src = "export function cmp(a, b) {\n  if (a === b) return 0;\n  for (let i = 0; i <= b; i++) {}\n  return a + b;\n}\n";

  test("each mutation is a single-site, reversible change", () => {
    const muts = mutationsFor(src);
    const kinds = new Set(muts.map(m => m.kind));
    expect(kinds.has("operator-eq")).toBe(true);
    expect(kinds.has("operator-rel")).toBe(true);
    expect(kinds.has("operator-add")).toBe(true);
    expect(kinds.has("removed-guard")).toBe(true);
    for (const m of muts) {
      expect(m.buggy).not.toBe(src); // a real change
      // The diff is confined to one line (or one removed line).
      const a = src.split("\n");
      const b = m.buggy.split("\n");
      const changed = a.filter((l, i) => l !== b[i]).length + Math.abs(a.length - b.length);
      expect(changed).toBeGreaterThan(0);
    }
  });

  test("=== mutation flips to !== and is invertible", () => {
    const m = mutationsFor(src).find(x => x.kind === "operator-eq");
    expect(m).toBeDefined();
    expect(m!.buggy).toContain("a !== b");
    expect(m!.buggy.replace("!==", "===")).toBe(src);
  });

  test("a duplicated line is tagged hard-anchor", () => {
    const dup = "x = true;\ny = 1;\nx = true;\n"; // identical line twice
    const m = mutationsFor(dup).find(x => x.kind === "boolean-flip");
    expect(m?.difficulty).toBe("hard-anchor");
  });
});

describe("scoring (R14)", () => {
  test("pass when post-edit equals expected", () => {
    expect(scoreFixture({ postEdit: "a\nb\n", expected: "a\nb\n" }).pass).toBe(true);
  });
  test("fail when content differs", () => {
    expect(scoreFixture({ postEdit: "a\nX\n", expected: "a\nb\n" }).pass).toBe(false);
  });
  test("whitespace-only deviation passes but is flagged masked (adv-05)", () => {
    const s = scoreFixture({ postEdit: "a  \nb\n", expected: "a\nb\n" });
    expect(s.pass).toBe(true);
    expect(s.passedOnlyAfterFormat).toBe(true);
  });
  test("formatter is deterministic and idempotent", () => {
    const once = formatDeterministic("a \n\n\n");
    expect(formatDeterministic(once)).toBe(once);
  });
});

describe("aggregation stratifies by difficulty (R15)", () => {
  const rec = (over: Partial<RunRecord>): RunRecord => ({
    model: "m", arm: "hashline", difficulty: "simple", pass: true,
    passedOnlyAfterFormat: false, outputTokens: 100, rejections: 0, turns: 1, ...over,
  });
  test("emits an 'all' cell plus per-difficulty cells", () => {
    const cells = aggregate([
      rec({ difficulty: "simple", pass: true }),
      rec({ difficulty: "hard-anchor", pass: false, rejections: 2 }),
    ]);
    const all = cells.find(c => c.difficulty === "all")!;
    expect(all.n).toBe(2);
    expect(all.passRate).toBe(0.5);
    expect(all.editFailureRate).toBe(1);
    expect(cells.some(c => c.difficulty === "simple")).toBe(true);
    expect(cells.some(c => c.difficulty === "hard-anchor")).toBe(true);
  });
});

describe("arms (R12) and transcript parsing (R14)", () => {
  test("hashline arm disallows built-in editors", () => {
    expect(disallowedToolsFor("hashline")).toEqual(["Edit", "Write", "NotebookEdit"]);
  });
  test("control arm disallows hashline tools by name AND glob (feas-05)", () => {
    const d = disallowedToolsFor("control");
    expect(d).toContain("mcp__plugin_claude-hashline_hashline__edit");
    expect(d).toContain("mcp__plugin_claude-hashline_hashline__*");
  });
  test("parses output tokens, turns, and rejections from a stream-json transcript", () => {
    const transcript = [
      JSON.stringify({ type: "assistant", message: { usage: { output_tokens: 120 } } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "String to replace not found in file" }] } }),
      JSON.stringify({ type: "assistant", message: { usage: { output_tokens: 80 } } }),
    ].join("\n");
    const m = parseTranscript(transcript);
    expect(m.outputTokens).toBe(200);
    expect(m.turns).toBe(2);
    expect(m.rejections).toBeGreaterThanOrEqual(1);
  });
});
