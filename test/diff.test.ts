import { describe, expect, test } from "bun:test";
import { buildCompactDiffPreview } from "@oh-my-pi/hashline";
import { generateDiffString } from "../src/diff.ts";

/**
 * Load-bearing invariant: the preview returned to the model after an edit must
 * be anchored to the post-edit file, so a chained follow-up edit can target a
 * visible line with no re-read. Every `N:content` preview row must equal line N
 * of the after-file. A drift here silently steers the model to edit the wrong
 * line. We assert it across the producer (generateDiffString) -> consumer
 * (buildCompactDiffPreview) pipeline that core.ts wires together.
 */
function previewRowsMatchAfter(
  before: string,
  after: string,
  contextLines?: number,
): void {
  const { diff } = generateDiffString(before, after, contextLines);
  const preview = buildCompactDiffPreview(diff).preview;
  const afterLines = after.split("\n");
  for (const row of preview.split("\n")) {
    const m = /^(\d+):([\s\S]*)$/.exec(row);
    if (!m) continue; // elision marker / blank gap row
    const n = Number(m[1]);
    expect(afterLines[n - 1]).toBe(m[2]);
  }
}

const lines = (...xs: string[]) => xs.join("\n");

describe("generateDiffString -> buildCompactDiffPreview line anchoring", () => {
  const A = lines(
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
  );
  const cases: Record<string, string> = {
    "replace middle": lines(
      "one",
      "two",
      "THREE",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ),
    "replace first line": lines(
      "ONE",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ),
    "replace last line": lines(
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "EIGHT",
    ),
    "pure insertion": lines(
      "one",
      "two",
      "two-and-a-half",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ),
    "pure deletion": lines(
      "one",
      "two",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ),
    "asymmetric replace (1->3)": lines(
      "one",
      "two",
      "3a",
      "3b",
      "3c",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ),
    "two far-apart changes (middleSkip)": lines(
      "ONE",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "EIGHT",
    ),
    "two near changes": lines(
      "one",
      "TWO",
      "three",
      "FOUR",
      "five",
      "six",
      "seven",
      "eight",
    ),
  };
  for (const [name, after] of Object.entries(cases)) {
    test(name, () => previewRowsMatchAfter(A, after));
  }

  test("contextLines=0", () =>
    previewRowsMatchAfter(A, cases["replace middle"], 0));
  test("no trailing newline", () =>
    previewRowsMatchAfter("a\nb\nc", "a\nB\nc", 2));
  test("empty before (file creation)", () =>
    previewRowsMatchAfter("", "x\ny\nz", 2));
});

describe("generateDiffString.firstChangedLine", () => {
  test("points at the first changed NEW-file line", () => {
    const before = lines("one", "two", "three");
    const after = lines("one", "TWO", "three");
    expect(generateDiffString(before, after).firstChangedLine).toBe(2);
  });
  test("undefined when identical", () => {
    expect(generateDiffString("a\nb", "a\nb").firstChangedLine).toBeUndefined();
  });
});
