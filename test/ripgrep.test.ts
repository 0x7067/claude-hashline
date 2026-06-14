import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { buildRipgrepArgs, type RipgrepMessage, runRipgrep } from "../src/ripgrep.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "rg-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Search args mirroring what the argv builder produces, for direct rg tests. */
function searchArgv(pattern: string): string[] {
  return ["--json", "-B1", "-A3", "--no-require-git", "--sort", "path", "-e", pattern, "."];
}

async function drain(gen: AsyncGenerator<RipgrepMessage>): Promise<RipgrepMessage[]> {
  const out: RipgrepMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

describe("runRipgrep (U1)", () => {
  test("happy path: matching files yield begin/match/context/end with line numbers and text", async () => {
    writeFileSync(path.join(root, "a.ts"), "const x = 1;\nconst target = 2;\nconst y = 3;\n");
    writeFileSync(path.join(root, "b.ts"), "let z = 0;\nconst target = 9;\n");
    const msgs = await drain(runRipgrep({ argv: searchArgv("target"), cwd: root }));

    const begins = msgs.filter(m => m.type === "begin").map(m => m.data.path.text);
    expect(begins).toContain("./a.ts");
    expect(begins).toContain("./b.ts");

    const matches = msgs.filter(m => m.type === "match");
    const aMatch = matches.find(m => m.data.path.text === "./a.ts");
    expect(aMatch?.data.line_number).toBe(2);
    expect(aMatch?.data.lines.text).toContain("const target = 2;");

    // Context lines accompany matches (1 before / 3 after).
    const contexts = msgs.filter(m => m.type === "context");
    expect(contexts.some(c => c.data.lines.text?.includes("const x = 1;"))).toBe(true);

    // Every begin has a matching end.
    expect(msgs.filter(m => m.type === "end").length).toBe(begins.length);
  });

  test("zero matches: exit code 1 yields an empty stream and does not throw", async () => {
    writeFileSync(path.join(root, "a.ts"), "nothing relevant here\n");
    const msgs = await drain(runRipgrep({ argv: searchArgv("zzz_absent"), cwd: root }));
    expect(msgs).toEqual([]);
  });

  test("spawn failure (bogus binary) throws an actionable error naming ripgrep", async () => {
    writeFileSync(path.join(root, "a.ts"), "target\n");
    const run = runRipgrep({ argv: searchArgv("target"), cwd: root, bin: "/nonexistent/definitely/not/rg" });
    await expect(drain(run)).rejects.toThrow(/ripgrep/i);
  });
});

describe("buildRipgrepArgs (U2)", () => {
  test("base argv: --json, 1-before/3-after, --no-require-git, --sort path, -e pattern, default path .", () => {
    const argv = buildRipgrepArgs({ pattern: "foo" });
    expect(argv).toEqual(["--json", "-B1", "-A3", "--no-require-git", "--sort", "path", "-e", "foo", "."]);
  });

  test("i:true adds -i; omitted does not", () => {
    expect(buildRipgrepArgs({ pattern: "x", i: true })).toContain("-i");
    expect(buildRipgrepArgs({ pattern: "x" })).not.toContain("-i");
  });

  test("gitignore:false adds --no-ignore; default does not", () => {
    expect(buildRipgrepArgs({ pattern: "x", gitignore: false })).toContain("--no-ignore");
    expect(buildRipgrepArgs({ pattern: "x" })).not.toContain("--no-ignore");
    expect(buildRipgrepArgs({ pattern: "x", gitignore: true })).not.toContain("--no-ignore");
  });

  test("multiline:true adds -U", () => {
    expect(buildRipgrepArgs({ pattern: "x", multiline: true })).toContain("-U");
    expect(buildRipgrepArgs({ pattern: "x" })).not.toContain("-U");
  });

  test("paths are appended as positional args, replacing the default .", () => {
    const argv = buildRipgrepArgs({ pattern: "x", paths: ["src", "bench"] });
    expect(argv.slice(-2)).toEqual(["src", "bench"]);
    expect(argv).toContain("bench");
    expect(argv).not.toContain(".");
  });

  test("a pattern beginning with - is guarded by -e (not parsed as a flag)", () => {
    const argv = buildRipgrepArgs({ pattern: "-foo" });
    expect(argv[argv.indexOf("-e") + 1]).toBe("-foo");
  });
});
