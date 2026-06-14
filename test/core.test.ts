import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createContext, hashlineEdit, hashlineRead, hashlineSearch, type HashlineContext } from "../src/core.ts";
import { JailedFilesystem } from "../src/jailed-fs.ts";

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

describe("symlinked-root canonicalization (jail false-positive regression)", () => {
  // The benchmark surfaced this: a workspace under a symlinked path (macOS
  // /var -> /private/var) stored a non-canonical root, so a valid in-workspace
  // file given by its realpath read as an escape and was wrongly rejected.
  test("a realpath'd in-workspace path is accepted, real escapes still rejected", () => {
    const base = mkdtempSync(path.join(tmpdir(), "hashline-sym-"));
    try {
      const realDir = path.join(base, "real");
      mkdirSync(realDir);
      const linkDir = path.join(base, "link");
      symlinkSync(realDir, linkDir);
      const fsj = new JailedFilesystem(linkDir); // rooted at the symlink

      // Same file addressed via the canonical (realpath) prefix must resolve inside.
      const viaReal = path.join(realpathSync(linkDir), "f.ts");
      expect(() => fsj.resolveInside(viaReal)).not.toThrow();
      // A genuine escape still throws.
      expect(() => fsj.resolveInside(path.join(base, "outside.ts"))).toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("directory read lists files (discovery self-correction)", () => {
  test("reading a directory returns its file listing, not a not-found error", async () => {
    writeFileSync(path.join(root, "alpha.ts"), "export const a = 1;\n");
    writeFileSync(path.join(root, "beta.ts"), "export const b = 2;\n");
    const out = await hashlineRead(ctx, { path: "." });
    expect(out).toMatch(/is a directory/);
    expect(out).toContain("alpha.ts");
    expect(out).toContain("beta.ts");
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

describe("hashlineSearch", () => {
  test("matches across files, each under its own [PATH#TAG], match/context markers (R2)", async () => {
    writeFileSync(path.join(root, "a.ts"), "const x = 1;\nconst target = 2;\nconst y = 3;\n");
    writeFileSync(path.join(root, "b.ts"), "let z = 0;\nconst target = 9;\n");
    const out = await hashlineSearch(ctx, { pattern: "target" });
    expect(out).toMatch(/\[a\.ts#[0-9A-F]{4}\]/);
    expect(out).toMatch(/\[b\.ts#[0-9A-F]{4}\]/);
    expect(out).toContain("*2:const target = 2;"); // match line marked with *
    expect(out).toContain(" 1:const x = 1;"); // context above (leading space)
    expect(out).toContain(" 3:const y = 3;"); // context below (leading space)
  });

  test("edit-without-read: an edit anchored on a search hit applies with no prior read (R3)", async () => {
    writeFileSync(path.join(root, "c.ts"), "const a = 1;\nconst flag = true;\nconst b = 2;\n");
    const out = await hashlineSearch(ctx, { pattern: "flag" });
    const header = /(\[c\.ts#[0-9A-F]{4}\])/.exec(out)?.[1];
    expect(header).toBeTruthy();
    const res = await hashlineEdit(ctx, `${header}\nreplace 2..2:\n+const flag = false;`);
    expect(res.isError).toBe(false);
    expect(readFileSync(path.join(root, "c.ts"), "utf8")).toContain("const flag = false;");
  });

  test("hits one line apart merge into a single contiguous window (KTD4)", async () => {
    writeFileSync(path.join(root, "d.ts"), "hit one\nmiddle\nhit two\ntail\n");
    const out = await hashlineSearch(ctx, { pattern: "hit" });
    // Both hits + the line between them render once, no duplicated rows.
    expect(out.match(/^ 2:middle$/m)).toBeTruthy(); // context between two hits
    expect((out.match(/\*1:hit one/g) ?? []).length).toBe(1);
    expect((out.match(/\*3:hit two/g) ?? []).length).toBe(1);
  });

  test("case-insensitive search with i flag (mirrors oh-my-pi)", async () => {
    writeFileSync(path.join(root, "ci.ts"), "const Target = 1;\n");
    expect(await hashlineSearch(ctx, { pattern: "target" })).toBe("No matches found");
    expect(await hashlineSearch(ctx, { pattern: "target", i: true })).toContain("*1:const Target = 1;");
  });

  test("maxResults caps output and appends a truncation tail (R4/KTD5)", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `match ${i}`).join("\n");
    writeFileSync(path.join(root, "many.ts"), `${lines}\n`);
    const out = await hashlineSearch(ctx, { pattern: "match", maxResults: 3 });
    expect(out).toMatch(/truncated at 3 matches/);
  });

  test("symlink escaping the root is never matched or recorded (R5)", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "hashline-outside-"));
    writeFileSync(path.join(outside, "secret.ts"), "const secret = 1;\n");
    symlinkSync(path.join(outside, "secret.ts"), path.join(root, "link.ts"));
    const out = await hashlineSearch(ctx, { pattern: "secret" });
    expect(out).toBe("No matches found");
    rmSync(outside, { recursive: true, force: true });
  });

  test("no matches returns a self-correcting string, not an error", async () => {
    writeFileSync(path.join(root, "e.ts"), "nothing here\n");
    const out = await hashlineSearch(ctx, { pattern: "zzz_absent" });
    expect(out).toBe("No matches found");
  });

  test("over-long lines are truncated to 512 cols with an ellipsis (oh-my-pi maxColumns)", async () => {
    writeFileSync(path.join(root, "long.ts"), `const big = "${"x".repeat(600)}"; // hit\n`);
    const out = await hashlineSearch(ctx, { pattern: "hit" });
    expect(out).toContain("…");
    const row = out.split("\n").find(l => l.startsWith("*1:"));
    expect(row && row.length).toBeLessThanOrEqual(3 + 512 + 1); // "*1:" + 512 chars + "…"
  });

  test("walked-but-unmatched files are not snapshotted (KTD2)", async () => {
    writeFileSync(path.join(root, "matched.ts"), "const target = 1;\n");
    writeFileSync(path.join(root, "other.ts"), "const unrelated = 2;\n");
    await hashlineSearch(ctx, { pattern: "target" });
    // The unmatched file has no snapshot, so editing it is refused (read-before-edit gate).
    const res = await hashlineEdit(ctx, `[other.ts#AAAA]\nreplace 1..1:\n+const unrelated = 3;`);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/no hashline read recorded/i);
  });
});
