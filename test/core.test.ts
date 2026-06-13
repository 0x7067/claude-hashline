import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createContext, hashlineEdit, hashlineRead, type HashlineContext } from "../src/core.ts";

let root: string;
let ctx: HashlineContext;

function tagFrom(readOutput: string): string {
  const m = /^\[[^\]]+#([0-9A-F]{4})\]/.exec(readOutput);
  if (!m) throw new Error(`no tag in read output: ${readOutput}`);
  return m[1];
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "hashline-test-"));
  ctx = createContext(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("hashlineRead (R1)", () => {
  test("emits [PATH#TAG] header and LINE:TEXT rows", async () => {
    writeFileSync(path.join(root, "a.ts"), 'const x = 1;\nconst y = 2;\n');
    const out = await hashlineRead(ctx, { path: "a.ts" });
    expect(out).toMatch(/^\[a\.ts#[0-9A-F]{4}\]\n/);
    expect(out).toContain("1:const x = 1;");
    expect(out).toContain("2:const y = 2;");
  });

  test("identical content yields a stable tag; changed content differs", async () => {
    writeFileSync(path.join(root, "a.ts"), "a\nb\n");
    const t1 = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    const t2 = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    expect(t1).toBe(t2);
    writeFileSync(path.join(root, "a.ts"), "a\nc\n");
    const t3 = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    expect(t3).not.toBe(t1);
  });

  test("offset/limit slices output but the snapshot covers the whole file", async () => {
    writeFileSync(path.join(root, "big.ts"), Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n");
    const out = await hashlineRead(ctx, { path: "big.ts", offset: 3, limit: 2 });
    expect(out).toContain("3:line3");
    expect(out).toContain("4:line4");
    expect(out).not.toContain("5:line5");
    expect(out).toContain("more line(s)");
    // A whole-file edit anchored past the slice still validates (snapshot is full-file).
    const tag = tagFrom(out);
    const res = await hashlineEdit(ctx, `[big.ts#${tag}]\nreplace 9..9:\n+CHANGED`);
    expect(res.isError).toBe(false);
    expect(readFileSync(path.join(root, "big.ts"), "utf8")).toContain("CHANGED");
  });

  test("PathEscapeError on read outside the root (KTD9)", async () => {
    await expect(hashlineRead(ctx, { path: "../escape.ts" })).rejects.toThrow(/outside the workspace/);
  });
});

describe("hashlineEdit ops (R3)", () => {
  test("replace, insert after, insert head, delete", async () => {
    writeFileSync(path.join(root, "a.ts"), "one\ntwo\nthree\n");
    const tag = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    const res = await hashlineEdit(
      ctx,
      `[a.ts#${tag}]\nreplace 2..2:\n+TWO\ninsert after 3:\n+four\ninsert head:\n+zero\ndelete 1`,
    );
    expect(res.isError).toBe(false);
    // Original line 1 ("one") deleted, "zero" prepended, "two"->"TWO", "four" appended.
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("zero\nTWO\nthree\nfour\n");
  });
});

describe("stale-tag rejection (R5)", () => {
  test("a tag not matching live content is rejected without writing", async () => {
    writeFileSync(path.join(root, "a.ts"), "x\ny\n");
    await hashlineRead(ctx, { path: "a.ts" }); // record a snapshot
    const before = readFileSync(path.join(root, "a.ts"), "utf8");
    const res = await hashlineEdit(ctx, `[a.ts#0000]\nreplace 1..1:\n+Z`);
    expect(res.isError).toBe(true);
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe(before);
  });
});

describe("read-before-edit gate (R6/feas-03)", () => {
  test("editing a file with no snapshot this session is refused even if the tag matches live", async () => {
    writeFileSync(path.join(root, "a.ts"), "x\ny\n");
    // Compute the real live tag via a throwaway context, then edit on a FRESH
    // context that never read the file — the package alone would apply it.
    const probe = createContext(root);
    const liveTag = tagFrom(await hashlineRead(probe, { path: "a.ts" }));
    const fresh = createContext(root);
    const res = await hashlineEdit(fresh, `[a.ts#${liveTag}]\nreplace 1..1:\n+Z`);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/no hashline read recorded/i);
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("x\ny\n");
  });
});

describe("path containment in edit (KTD9 / SEC-002)", () => {
  test("a section path escaping the root is rejected before any write", async () => {
    const res = await hashlineEdit(ctx, `[../../evil.ts#AAAA]\nreplace 1..1:\n+pwned`);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/outside the workspace/);
  });
});

describe("file creation (R4/KTD10)", () => {
  test("tagless header + insert head body creates a new file", async () => {
    const res = await hashlineEdit(ctx, `[new.ts]\ninsert head:\n+export const x = 1;`);
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/\(create\)/);
    expect(readFileSync(path.join(root, "new.ts"), "utf8")).toBe("export const x = 1;\n");
  });

  test("creating an existing file is refused", async () => {
    writeFileSync(path.join(root, "dup.ts"), "exists\n");
    const res = await hashlineEdit(ctx, `[dup.ts]\ninsert head:\n+nope`);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/already exists/);
  });
});
