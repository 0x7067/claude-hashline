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

describe("recordEditSaving + readRollup", () => {
  test("appends a row and sums across calls", () => {
    const after = "x".repeat(400); // ~100 est tokens
    const input = "[a#ABCD]\nreplace 1:\n+x"; // tiny patch
    const s1 = recordEditSaving(root, input, [after]);
    expect(s1).not.toBeNull();
    expect(s1!.fullWriteTokens).toBe(100);
    expect(s1!.savedTokens).toBe(100 - estimateTokens(input));

    recordEditSaving(root, input, [after]);
    const r = readRollup(root);
    expect(r.edits).toBe(2);
    expect(r.fullWriteTokens).toBe(200);
    expect(r.savedTokens).toBe(2 * s1!.savedTokens);
    expect(existsSync(ledgerPathFor(root))).toBe(true);
  });

  test("disabled tracking writes nothing", () => {
    process.env.HASHLINE_TRACK_SAVINGS = "0";
    expect(recordEditSaving(root, "p", ["after"])).toBeNull();
    expect(readRollup(root)).toEqual({ edits: 0, fullWriteTokens: 0, patchTokens: 0, savedTokens: 0 });
  });

  test("empty afters (all-noop) records nothing", () => {
    expect(recordEditSaving(root, "p", [])).toBeNull();
    expect(readRollup(root).edits).toBe(0);
  });

  test("malformed ledger lines are skipped, not fatal", () => {
    recordEditSaving(root, "[a#ABCD]\nr", ["x".repeat(400)]);
    const file = ledgerPathFor(root);
    writeFileSync(file, readFileSync(file, "utf8") + "not-json\n");
    expect(readRollup(root).edits).toBe(1);
  });
});

describe("formatRollup", () => {
  test("labels the number as an estimate", () => {
    const out = formatRollup(root, { edits: 3, fullWriteTokens: 1000, patchTokens: 200, savedTokens: 800 });
    expect(out).toContain("estimated");
    expect(out.toLowerCase()).toContain("estimate only");
    expect(out).toContain("80%");
  });
});

describe("integration through hashlineEdit", () => {
  test("a real edit records a positive saving", async () => {
    const ctx = createContext(root);
    writeFileSync(path.join(root, "big.ts"), Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const tag = tagFrom(await hashlineRead(ctx, { path: "big.ts" }));
    const res = await hashlineEdit(ctx, `[big.ts#${tag}]\nreplace 1:\n+const v0 = 999;`);
    expect(res.isError).toBe(false);
    const r = readRollup(root);
    expect(r.edits).toBe(1);
    expect(r.savedTokens).toBeGreaterThan(0); // small patch replaced a whole-file write
  });
});
