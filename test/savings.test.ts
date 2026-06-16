import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createContext, hashlineEdit, hashlineRead } from "../src/core.ts";
import {
  estimateTokens,
  formatRollup,
  ledgerPathFor,
  readRollup,
  recordEditSaving,
  trackingEnabled,
  strReplaceTokens,
} from "../src/savings.ts";

let root: string;
let ledgerDir: string;
const savedEnv = { dir: process.env.HASHLINE_SAVINGS_DIR, track: process.env.HASHLINE_TRACK_SAVINGS };

function tagFrom(readOutput: string): string {
  const m = /^\[[^\]]+#([0-9A-F]{4})\]/.exec(readOutput);
  if (!m) throw new Error(`no tag in read output: ${readOutput}`);
  return m[1];
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "hashline-sav-root-"));
  ledgerDir = mkdtempSync(path.join(tmpdir(), "hashline-sav-dir-"));
  process.env.HASHLINE_SAVINGS_DIR = ledgerDir;
  delete process.env.HASHLINE_TRACK_SAVINGS; // default: enabled
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(ledgerDir, { recursive: true, force: true });
  if (savedEnv.dir === undefined) delete process.env.HASHLINE_SAVINGS_DIR;
  else process.env.HASHLINE_SAVINGS_DIR = savedEnv.dir;
  if (savedEnv.track === undefined) delete process.env.HASHLINE_TRACK_SAVINGS;
  else process.env.HASHLINE_TRACK_SAVINGS = savedEnv.track;
});

describe("estimateTokens", () => {
  test("chars/4, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("trackingEnabled", () => {
  test("on by default, off only for explicit falsey values", () => {
    delete process.env.HASHLINE_TRACK_SAVINGS;
    expect(trackingEnabled()).toBe(true);
    for (const v of ["0", "false", "off", "no", "FALSE", " Off "]) {
      process.env.HASHLINE_TRACK_SAVINGS = v;
      expect(trackingEnabled()).toBe(false);
    }
    for (const v of ["1", "true", "yes", ""]) {
      process.env.HASHLINE_TRACK_SAVINGS = v;
      expect(trackingEnabled()).toBe(true);
    }
  });
});

describe("strReplaceTokens (str_replace counterfactual)", () => {
  test("AE1: small replace in a big file ~ changed region, not the whole file", () => {
    const before = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 5", "line FIVE changed");
    const t = strReplaceTokens(before, after);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(estimateTokens(after) / 4); // tiny vs the whole file
  });
  test("AE2: pure insert -> old side empty, cost ~ inserted text only", () => {
    expect(strReplaceTokens("a\nb\nc", "a\nNEW\nb\nc")).toBe(estimateTokens("NEW"));
  });
  test("AE3: pure delete -> cost ~ deleted text", () => {
    expect(strReplaceTokens("a\nDEL1\nDEL2\nb", "a\nb")).toBe(estimateTokens("DEL1\nDEL2"));
  });
  test("create (before empty) -> cost ~ whole new body", () => {
    expect(strReplaceTokens("", "x\ny\nz")).toBe(estimateTokens("x\ny\nz"));
  });
  test("identical before/after -> 0", () => {
    expect(strReplaceTokens("a\nb", "a\nb")).toBe(0);
  });
});

describe("recordEditSaving + readRollup", () => {
  test("appends a v2 row and sums across calls", () => {
    const before = "keep\n" + "old".repeat(50); // 2 lines, 2nd is large
    const after = "keep\nnew content here";
    const input = "[a#ABCD]\nreplace 2:\n+new content here";
    const s1 = recordEditSaving(root, input, [{ before, after }]);
    expect(s1).not.toBeNull();
    expect(s1!.baselineTokens).toBe(strReplaceTokens(before, after));
    expect(s1!.savedTokens).toBe(s1!.baselineTokens - estimateTokens(input));

    recordEditSaving(root, input, [{ before, after }]);
    const r = readRollup(root);
    expect(r.current.edits).toBe(2);
    expect(r.legacy.edits).toBe(0);
    expect(r.current.savedTokens).toBe(2 * s1!.savedTokens);
    expect(existsSync(ledgerPathFor(root))).toBe(true);
  });

  test("legacy v1 rows are read under the legacy baseline, separate from v2", () => {
    const file = ledgerPathFor(root);
    writeFileSync(file, JSON.stringify({ v: 1, ts: 1, sections: 1, fullWriteTokens: 1000, patchTokens: 50, savedTokens: 950 }) + "\n");
    // A large old_string is the win case: hashline skips reproducing it, str_replace can't.
    recordEditSaving(root, "[a#ABCD]\nreplace 1:\n+yy", [{ before: "x".repeat(400) + "\nbbbb", after: "yy\nbbbb" }]);
    const r = readRollup(root);
    expect(r.legacy.edits).toBe(1);
    expect(r.legacy.savedTokens).toBe(950);
    expect(r.current.edits).toBe(1);
    expect(r.current.savedTokens).toBeGreaterThan(0);
  });

  test("disabled tracking writes nothing", () => {
    process.env.HASHLINE_TRACK_SAVINGS = "0";
    expect(recordEditSaving(root, "p", [{ before: "a", after: "b" }])).toBeNull();
    const r = readRollup(root);
    expect(r.current.edits).toBe(0);
    expect(r.legacy.edits).toBe(0);
  });

  test("empty sections (all-noop) records nothing", () => {
    expect(recordEditSaving(root, "p", [])).toBeNull();
    expect(readRollup(root).current.edits).toBe(0);
  });

  test("malformed ledger lines are skipped, not fatal", () => {
    recordEditSaving(root, "[a#ABCD]\nr", [{ before: "xxxx\nyyyy", after: "zz\nyyyy" }]);
    const file = ledgerPathFor(root);
    writeFileSync(file, readFileSync(file, "utf8") + "not-json\n");
    expect(readRollup(root).current.edits).toBe(1);
  });
});

describe("formatRollup", () => {
  const current = { edits: 3, baselineTokens: 1000, patchTokens: 200, savedTokens: 800 };
  test("labels estimate, str_replace baseline, and benchmark calibration", () => {
    const out = formatRollup(root, { current, legacy: { edits: 0, baselineTokens: 0, patchTokens: 0, savedTokens: 0 } });
    expect(out.toLowerCase()).toContain("estimate only");
    expect(out).toContain("str_replace");
    expect(out).toContain("9-21%");
    expect(out).toContain("80%"); // current pct
    expect(out.toLowerCase()).not.toContain("legacy");
  });
  test("renders a labeled legacy line only when legacy rows exist", () => {
    const out = formatRollup(root, { current, legacy: { edits: 8, baselineTokens: 33000, patchTokens: 1600, savedTokens: 31400 } });
    expect(out.toLowerCase()).toContain("legacy");
    expect(out.toLowerCase()).toContain("full-write");
  });
});

describe("integration through hashlineEdit", () => {
  test("a large edit records a positive saving (skips a big old_string)", async () => {
    const ctx = createContext(root);
    writeFileSync(path.join(root, "big.ts"), Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const tag = tagFrom(await hashlineRead(ctx, { path: "big.ts" }));
    // Delete 38 lines: hashline emits a tiny `delete`, str_replace would emit all 38 as old_string.
    const res = await hashlineEdit(ctx, `[big.ts#${tag}]\ndelete 2..39`);
    expect(res.isError).toBe(false);
    const r = readRollup(root);
    expect(r.current.edits).toBe(1);
    expect(r.current.savedTokens).toBeGreaterThan(0);
  });
});
