import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { claudeMemoryMatcher, claudePlansMatcher, createContext, explicitPathsMatcher, hashlineEdit, hashlineRead, hashlineSearch, type HashlineContext, normalizeColonRanges, systemTempMatcher } from "../src/core.ts";
import { JailedFilesystem } from "../src/jailed-fs.ts";

let root: string;
let ctx: HashlineContext;

function tagFrom(readOutput: string): string {
  const m = /^\[.+#([0-9A-F]{4})\]/.exec(readOutput); // greedy: tolerate bracketed paths like app/[id]/page.tsx
  if (!m) throw new Error(`no tag in read output: ${readOutput}`);
  return m[1];
}

// Edits here would otherwise append real ledgers to ~/.claude/hashline-savings/
// (recordEditSaving uses the live config dir). Disable tracking for this file.
const savedTrack = process.env.HASHLINE_TRACK_SAVINGS;
beforeEach(() => {
  process.env.HASHLINE_TRACK_SAVINGS = "0";
  root = mkdtempSync(path.join(tmpdir(), "hashline-test-"));
  ctx = createContext(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (savedTrack === undefined) delete process.env.HASHLINE_TRACK_SAVINGS;
  else process.env.HASHLINE_TRACK_SAVINGS = savedTrack;
});

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

describe("colon-range tolerance (optimize-loop cycle 1)", () => {
  test("normalizeColonRanges rewrites N:M ranges, leaves single-line N: alone", () => {
    expect(normalizeColonRanges("replace 23:23:")).toBe("replace 23..23:");
    expect(normalizeColonRanges("replace 12:14:")).toBe("replace 12..14:");
    expect(normalizeColonRanges("delete 5:8")).toBe("delete 5..8");
    // Single-line replace is valid syntax and must be preserved.
    expect(normalizeColonRanges("replace 23:")).toBe("replace 23:");
    // Already-correct ranges and body rows are untouched.
    expect(normalizeColonRanges("replace 2..2:\n+hi")).toBe("replace 2..2:\n+hi");
    // A `+`-body line that contains a colon range is not a header — leave it.
    expect(normalizeColonRanges("+const a = b ? 1:2;")).toBe("+const a = b ? 1:2;");
  });

  test("hashlineEdit applies a colon-range header that the grammar would reject", async () => {
    writeFileSync(path.join(root, "a.ts"), "one\ntwo\nthree\n");
    const tag = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    // Model wrote a colon range copied from the read-row label; harness tolerates it.
    const res = await hashlineEdit(ctx, `[a.ts#${tag}]\nreplace 2:2:\n+TWO`);
    expect(res.isError).toBe(false);
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("one\nTWO\nthree\n");
  });
});

describe("edit-result window enables chaining (R1, R2)", () => {
  test("edit returns post-edit tag + numbered window; a chained edit applies with no re-read", async () => {
    writeFileSync(path.join(root, "a.ts"), "one\ntwo\nthree\nfour\nfive\n");
    const tag1 = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    const r1 = await hashlineEdit(ctx, `[a.ts#${tag1}]\nreplace 2..2:\n+TWO`);
    expect(r1.isError).toBe(false);
    // Window shows the changed line at its post-edit number.
    expect(r1.text).toContain("2:TWO");
    // Chain a second edit using ONLY the tag from r1 — no intervening read.
    const tag2 = tagFrom(r1.text);
    const r2 = await hashlineEdit(ctx, `[a.ts#${tag2}]\nreplace 4..4:\n+FOUR`);
    expect(r2.isError).toBe(false);
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("one\nTWO\nthree\nFOUR\nfive\n");
  });

  test("window tag matches a fresh read of the post-edit file (re-anchor correctness)", async () => {
    writeFileSync(path.join(root, "a.ts"), "a\nb\nc\n");
    const tag = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    const r = await hashlineEdit(ctx, `[a.ts#${tag}]\nreplace 2..2:\n+B`);
    expect(r.isError).toBe(false);
    const freshTag = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    expect(tagFrom(r.text)).toBe(freshTag);
  });

  test("insert shifts numbers; chained edit references the shifted line with no re-read", async () => {
    writeFileSync(path.join(root, "a.ts"), "one\ntwo\nthree\n");
    const tag1 = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    // Insert two lines after line 1 -> "three" moves from line 3 to line 5.
    const r1 = await hashlineEdit(ctx, `[a.ts#${tag1}]\ninsert after 1:\n+x\n+y`);
    expect(r1.isError).toBe(false);
    const tag2 = tagFrom(r1.text);
    const r2 = await hashlineEdit(ctx, `[a.ts#${tag2}]\nreplace 5..5:\n+THREE`);
    expect(r2.isError).toBe(false);
    expect(readFileSync(path.join(root, "a.ts"), "utf8")).toBe("one\nx\ny\ntwo\nTHREE\n");
  });

  test("noop edit surfaces the tag and no window", async () => {
    writeFileSync(path.join(root, "a.ts"), "one\ntwo\n");
    const tag = tagFrom(await hashlineRead(ctx, { path: "a.ts" }));
    const r = await hashlineEdit(ctx, `[a.ts#${tag}]\nreplace 1..1:\n+one`); // identical -> noop
    expect(r.isError).toBe(false);
    expect(r.text).toContain("no change");
    expect(r.text).toMatch(/^\[a\.ts#[0-9A-F]{4}\]/);
  });

  test("overflow hint fires only when the preview omits part of the file", async () => {
    // Whole file fits the window -> no hint (trailing newline must not inflate the count).
    writeFileSync(path.join(root, "small.ts"), "one\ntwo\nthree\n");
    const t1 = tagFrom(await hashlineRead(ctx, { path: "small.ts" }));
    const small = await hashlineEdit(ctx, `[small.ts#${t1}]\nreplace 2..2:\n+TWO`);
    expect(small.text).not.toContain("lines total");
    // A change in a larger file shows only context -> hint points the model to re-read.
    writeFileSync(path.join(root, "big.ts"), Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join("\n") + "\n");
    const t2 = tagFrom(await hashlineRead(ctx, { path: "big.ts" }));
    const big = await hashlineEdit(ctx, `[big.ts#${t2}]\nreplace 15..15:\n+CHANGED`);
    expect(big.text).toContain("30 lines total");
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

  test("create + edit a bracketed dynamic-route path (app/[id]/page.tsx)", async () => {
    const p = "app/[id]/page.tsx";
    const created = await hashlineEdit(ctx, `[${p}]\ninsert head:\n+export default function Page() {}`);
    expect(created.isError).toBe(false);
    expect(readFileSync(path.join(root, p), "utf8")).toBe("export default function Page() {}\n");
    // round-trip: read back the bracketed path and apply a tagged edit
    const tag = tagFrom(await hashlineRead(ctx, { path: p }));
    const edited = await hashlineEdit(ctx, `[${p}#${tag}]\nreplace 1..1:\n+export default function Page() { return null; }`);
    expect(edited.isError).toBe(false);
    expect(readFileSync(path.join(root, p), "utf8")).toBe("export default function Page() { return null; }\n");
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

describe("Claude memory carve-out (HASHLINE_ALLOW_MEMORY)", () => {
  let configDir: string;
  let memDir: string;
  let savedConfig: string | undefined;
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedConfig = process.env.CLAUDE_CONFIG_DIR;
    savedAllow = process.env.HASHLINE_ALLOW_MEMORY;
    configDir = mkdtempSync(path.join(tmpdir(), "hashline-cfg-"));
    memDir = path.join(configDir, "projects", "-some-slug", "memory");
    mkdirSync(memDir, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedConfig;
    if (savedAllow === undefined) delete process.env.HASHLINE_ALLOW_MEMORY;
    else process.env.HASHLINE_ALLOW_MEMORY = savedAllow;
  });

  test("flag on: read + create + edit succeed under projects/<slug>/memory", async () => {
    process.env.HASHLINE_ALLOW_MEMORY = "1";
    const c = createContext(root);
    const memFile = path.join(memDir, "foo.md");
    const created = await hashlineEdit(c, `[${memFile}]\ninsert head:\n+# note\n+body`);
    expect(created.isError).toBe(false);
    expect(readFileSync(memFile, "utf8")).toContain("# note");
    const out = await hashlineRead(c, { path: memFile });
    expect(out).toContain("1:# note");
    const res = await hashlineEdit(c, `[${memFile}#${tagFrom(out)}]\nreplace 2..2:\n+changed`);
    expect(res.isError).toBe(false);
    expect(readFileSync(memFile, "utf8")).toContain("changed");
  });

  test("flag on: non-memory siblings under the same project are still rejected", async () => {
    process.env.HASHLINE_ALLOW_MEMORY = "1";
    const c = createContext(root);
    const sib = path.join(configDir, "projects", "-some-slug", "sessions", "x.md");
    mkdirSync(path.dirname(sib), { recursive: true });
    writeFileSync(sib, "secret\n");
    await expect(hashlineRead(c, { path: sib })).rejects.toThrow(/outside the workspace/);
    const top = path.join(configDir, "projects", "-some-slug", "x.md");
    writeFileSync(top, "secret\n");
    await expect(hashlineRead(c, { path: top })).rejects.toThrow(/outside the workspace/);
  });

  test("flag on: projects/memory with no slug segment is rejected", async () => {
    process.env.HASHLINE_ALLOW_MEMORY = "1";
    const c = createContext(root);
    const noSlug = path.join(configDir, "projects", "memory", "x.md");
    mkdirSync(path.dirname(noSlug), { recursive: true });
    writeFileSync(noSlug, "secret\n");
    await expect(hashlineRead(c, { path: noSlug })).rejects.toThrow(/outside the workspace/);
  });

  test("flag off: the memory path is rejected (default-conservative)", async () => {
    delete process.env.HASHLINE_ALLOW_MEMORY;
    const c = createContext(root);
    const memFile = path.join(memDir, "foo.md");
    writeFileSync(memFile, "x\n");
    await expect(hashlineRead(c, { path: memFile })).rejects.toThrow(/outside the workspace/);
  });

  test("claudeMemoryMatcher: segment logic + CLAUDE_CONFIG_DIR honor", () => {
    const match = claudeMemoryMatcher();
    const base = path.join(realpathSync(configDir), "projects");
    expect(match(path.join(base, "slug", "memory"))).toBe(true);
    expect(match(path.join(base, "slug", "memory", "deep", "n.md"))).toBe(true);
    expect(match(path.join(base, "slug", "sessions", "x.md"))).toBe(false);
    expect(match(path.join(base, "slug", "x.md"))).toBe(false);
    expect(match(path.join(base, "memory", "x.md"))).toBe(false);
    expect(match("/etc/passwd")).toBe(false);
  });
});

describe("Claude plans carve-out (HASHLINE_ALLOW_PLANS)", () => {
  let configDir: string;
  let plansDir: string;
  let savedConfig: string | undefined;
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedConfig = process.env.CLAUDE_CONFIG_DIR;
    savedAllow = process.env.HASHLINE_ALLOW_PLANS;
    configDir = mkdtempSync(path.join(tmpdir(), "hashline-cfg-"));
    plansDir = path.join(configDir, "plans");
    mkdirSync(plansDir, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedConfig;
    if (savedAllow === undefined) delete process.env.HASHLINE_ALLOW_PLANS;
    else process.env.HASHLINE_ALLOW_PLANS = savedAllow;
  });

  test("flag on: create + edit succeed under plans/", async () => {
    process.env.HASHLINE_ALLOW_PLANS = "1";
    const c = createContext(root);
    const f = path.join(plansDir, "my-plan.md");
    const created = await hashlineEdit(c, `[${f}]\ninsert head:\n+# plan\n+step 1`);
    expect(created.isError).toBe(false);
    expect(readFileSync(f, "utf8")).toContain("# plan");
  });

  test("flag off: the plans path is rejected (default-conservative)", async () => {
    delete process.env.HASHLINE_ALLOW_PLANS;
    const c = createContext(root);
    const f = path.join(plansDir, "my-plan.md");
    writeFileSync(f, "x\n");
    await expect(hashlineRead(c, { path: f })).rejects.toThrow(/outside the workspace/);
  });

  test("claudePlansMatcher: prefix logic + CLAUDE_CONFIG_DIR honor", () => {
    const match = claudePlansMatcher();
    const base = path.join(realpathSync(configDir), "plans");
    expect(match(base)).toBe(true);
    expect(match(path.join(base, "deep", "p.md"))).toBe(true);
    expect(match(path.join(realpathSync(configDir), "settings.json"))).toBe(false);
    expect(match("/etc/passwd")).toBe(false);
  });
});

describe("system temp-dir carve-out (HASHLINE_ALLOW_TMP)", () => {
  // `root` (from the top-level beforeEach) lives under tmpdir, so to prove the
  // tmp carve-out — not the workspace root — is what permits the write, target a
  // sibling temp dir that is under tmpdir but OUTSIDE root.
  let sibling: string;
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedAllow = process.env.HASHLINE_ALLOW_TMP;
    sibling = mkdtempSync(path.join(tmpdir(), "hashline-sib-"));
  });
  afterEach(() => {
    rmSync(sibling, { recursive: true, force: true });
    if (savedAllow === undefined) delete process.env.HASHLINE_ALLOW_TMP;
    else process.env.HASHLINE_ALLOW_TMP = savedAllow;
  });

  test("flag on: read + create + edit succeed for a temp file outside the root", async () => {
    process.env.HASHLINE_ALLOW_TMP = "1";
    const c = createContext(root);
    const tmpFile = path.join(sibling, "pr-body.md");
    const created = await hashlineEdit(c, `[${tmpFile}]\ninsert head:\n+# PR\n+body`);
    expect(created.isError).toBe(false);
    expect(readFileSync(tmpFile, "utf8")).toContain("# PR");
    const out = await hashlineRead(c, { path: tmpFile });
    const res = await hashlineEdit(c, `[${tmpFile}#${tagFrom(out)}]\nreplace 2..2:\n+changed`);
    expect(res.isError).toBe(false);
    expect(readFileSync(tmpFile, "utf8")).toContain("changed");
  });

  test("flag off: a temp file outside the root is rejected (default-conservative)", async () => {
    delete process.env.HASHLINE_ALLOW_TMP;
    const c = createContext(root);
    const tmpFile = path.join(sibling, "pr-body.md");
    writeFileSync(tmpFile, "x\n");
    await expect(hashlineRead(c, { path: tmpFile })).rejects.toThrow(/outside the workspace/);
  });

  test("systemTempMatcher: accepts tmpdir paths, rejects elsewhere", () => {
    const match = systemTempMatcher();
    const base = realpathSync(tmpdir());
    expect(match(path.join(base, "scratch.md"))).toBe(true);
    expect(match(path.join(base, "a", "b", "c.md"))).toBe(true);
    expect(match("/etc/passwd")).toBe(false);
  });
});

describe("explicit-paths carve-out (HASHLINE_ALLOW_PATHS)", () => {
  // `root` lives under tmpdir; target a sibling dir OUTSIDE root and allow it
  // explicitly, proving the list carve-out (not the workspace root) permits it.
  let sibling: string;
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedAllow = process.env.HASHLINE_ALLOW_PATHS;
    sibling = mkdtempSync(path.join(tmpdir(), "hashline-allow-"));
  });
  afterEach(() => {
    rmSync(sibling, { recursive: true, force: true });
    if (savedAllow === undefined) delete process.env.HASHLINE_ALLOW_PATHS;
    else process.env.HASHLINE_ALLOW_PATHS = savedAllow;
  });

  test("listed root: read + create + edit succeed outside the workspace", async () => {
    process.env.HASHLINE_ALLOW_PATHS = sibling;
    const c = createContext(root);
    const f = path.join(sibling, "config.toml");
    const created = await hashlineEdit(c, `[${f}]\ninsert head:\n+a = 1`);
    expect(created.isError).toBe(false);
    const out = await hashlineRead(c, { path: f });
    const res = await hashlineEdit(c, `[${f}#${tagFrom(out)}]\nreplace 1..1:\n+a = 2`);
    expect(res.isError).toBe(false);
    expect(readFileSync(f, "utf8")).toContain("a = 2");
  });

  test("unset: a path outside the root is rejected", async () => {
    delete process.env.HASHLINE_ALLOW_PATHS;
    const c = createContext(root);
    const f = path.join(sibling, "config.toml");
    writeFileSync(f, "x\n");
    await expect(hashlineRead(c, { path: f })).rejects.toThrow(/outside the workspace/);
  });

  test("explicitPathsMatcher: accepts listed roots (incl. ~/ expansion), rejects elsewhere", () => {
    process.env.HASHLINE_ALLOW_PATHS = `${sibling}${path.delimiter}~/.agents`;
    const match = explicitPathsMatcher()!;
    const base = realpathSync(sibling);
    expect(match(path.join(base, "x.md"))).toBe(true);
    expect(match(path.join(realpathSync(homedir()), ".agents", "skills", "s.md"))).toBe(true);
    expect(match("/etc/passwd")).toBe(false);
    delete process.env.HASHLINE_ALLOW_PATHS;
    expect(explicitPathsMatcher()).toBeUndefined();
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

  test("gitignored files are skipped by default, included with gitignore:false (oh-my-pi parity)", async () => {
    writeFileSync(path.join(root, ".gitignore"), "*.log\n");
    writeFileSync(path.join(root, "keep.ts"), "const hit = 1;\n");
    writeFileSync(path.join(root, "debug.log"), "hit in log\n");

    const def = await hashlineSearch(ctx, { pattern: "hit" });
    expect(def).toContain("keep.ts"); // non-ignored sibling still matches
    expect(def).not.toContain("debug.log"); // ignored file excluded by default

    const all = await hashlineSearch(ctx, { pattern: "hit", gitignore: false });
    expect(all).toContain("debug.log"); // opt-out includes it
  });

  test("no .gitignore present behaves as before (no regression)", async () => {
    writeFileSync(path.join(root, "plain.ts"), "const hit = 1;\n");
    const out = await hashlineSearch(ctx, { pattern: "hit" });
    expect(out).toContain("plain.ts");
  });

  test("paths arg scopes the search to a subdirectory (R5)", async () => {
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "sub", "inside.ts"), "const hit = 1;\n");
    writeFileSync(path.join(root, "root.ts"), "const hit = 2;\n");
    const out = await hashlineSearch(ctx, { pattern: "hit", paths: ["sub"] });
    expect(out).toContain("sub/inside.ts");
    expect(out).not.toContain("root.ts");
  });

  test("a paths entry escaping the jail is rejected before searching (R8)", async () => {
    await expect(hashlineSearch(ctx, { pattern: "x", paths: ["../escape"] })).rejects.toThrow(/outside the workspace/);
  });
  test("multiline arg matches a pattern spanning lines (R6)", async () => {
    writeFileSync(path.join(root, "ml.ts"), "foo\nbar\n");
    // Without multiline, ripgrep rejects a `\n` literal in the pattern (exit 2 → throw).
    await expect(hashlineSearch(ctx, { pattern: "foo\\nbar" })).rejects.toThrow(/ripgrep|multiline|new line/i);
    // With multiline, the same pattern matches across the two lines.
    const out = await hashlineSearch(ctx, { pattern: "foo\\nbar", multiline: true });
    expect(out).toMatch(/\[ml\.ts#[0-9A-F]{4}\]/);
  });
});

describe("live cwd follows a worktree switch (CLAUDE_CODE_SESSION_ID)", () => {
  const savedSid = process.env.CLAUDE_CODE_SESSION_ID;
  let sid: string;
  let live: string; // stands in for the worktree the session moved into
  let cwdFile: string;

  beforeEach(() => {
    sid = `hashline-test-${process.pid}-${root.split(path.sep).pop()}`;
    process.env.CLAUDE_CODE_SESSION_ID = sid;
    live = mkdtempSync(path.join(tmpdir(), "hashline-live-"));
    const cwdDir = path.join(tmpdir(), "claude-hashline-cwd");
    mkdirSync(cwdDir, { recursive: true });
    cwdFile = path.join(cwdDir, sid);
    writeFileSync(cwdFile, live);
  });
  afterEach(() => {
    rmSync(live, { recursive: true, force: true });
    rmSync(cwdFile, { force: true });
    if (savedSid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = savedSid;
  });

  test("read+edit hit the live cwd, not the launch root", async () => {
    // Same relative name exists in BOTH dirs with different content; the launch
    // root's copy must stay untouched.
    writeFileSync(path.join(root, "f.ts"), "launch\n");
    writeFileSync(path.join(live, "f.ts"), "worktree\n");
    const out = await hashlineRead(ctx, { path: "f.ts" });
    expect(out).toContain("worktree");
    const tag = tagFrom(out);
    const res = await hashlineEdit(ctx, `[f.ts#${tag}]\nreplace 1..1:\n+edited`);
    expect(res.isError).toBe(false);
    expect(readFileSync(path.join(live, "f.ts"), "utf8")).toBe("edited\n");
    expect(readFileSync(path.join(root, "f.ts"), "utf8")).toBe("launch\n"); // untouched
  });

  test("falls back to launch root when the hook file is absent", async () => {
    rmSync(cwdFile, { force: true });
    writeFileSync(path.join(root, "g.ts"), "launch\n");
    const out = await hashlineRead(ctx, { path: "g.ts" });
    expect(out).toContain("launch");
  });
});
