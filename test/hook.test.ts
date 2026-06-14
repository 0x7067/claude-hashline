import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const SCRIPT = path.join(import.meta.dir, "..", "hooks", "scripts", "block-edit.sh");
const SAMPLE = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "a.ts" } });

async function runHook(opts: { env?: Record<string, string>; cwd?: string }): Promise<string> {
  const proc = Bun.spawn(["bash", SCRIPT], {
    cwd: opts.cwd,
    env: { PATH: process.env.PATH ?? "", ...opts.env },
    stdin: new TextEncoder().encode(SAMPLE),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("block hook — opt-in enforcement (R7/R9, global-safe)", () => {
  test("allows by default when the project has NOT opted in (fail-open)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      const out = await runHook({ cwd: work, env: { HOME: "/nonexistent-home" } });
      expect(out.trim()).toBe(""); // no marker, no env -> allow
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("denies when the project opted in via a .hashline-enforce marker", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      writeFileSync(path.join(work, ".hashline-enforce"), "");
      const out = await runHook({ cwd: work, env: { HOME: "/nonexistent-home" } });
      const json = JSON.parse(out);
      expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/hashline edit tool/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("a .hashline-enforce marker in an ancestor directory opts in", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hashline-root-"));
    try {
      writeFileSync(path.join(root, ".hashline-enforce"), "");
      const sub = path.join(root, "pkg", "src");
      mkdirSync(sub, { recursive: true });
      const out = await runHook({ cwd: sub, env: { HOME: "/nonexistent-home" } });
      expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("HASHLINE_ENFORCE=1 opts in without a marker", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      const out = await runHook({ cwd: work, env: { HOME: "/nonexistent-home", HASHLINE_ENFORCE: "1" } });
      expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("HASHLINE_DISABLED beats enforcement (R9)", async () => {
    const out = await runHook({ env: { HOME: "/nonexistent-home", HASHLINE_ENFORCE: "1", HASHLINE_DISABLED: "1" } });
    expect(out.trim()).toBe("");
  });

  test("a trusted-dir (HOME) sentinel beats enforcement", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "hashline-home-"));
    try {
      writeFileSync(path.join(home, ".hashline-off"), "");
      const out = await runHook({ env: { HOME: home, HASHLINE_ENFORCE: "1" } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a cwd .hashline-off does NOT bypass under enforcement (SEC-003)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    const home = mkdtempSync(path.join(tmpdir(), "hashline-home-"));
    try {
      writeFileSync(path.join(work, ".hashline-off"), ""); // cwd disable is NOT trusted
      const out = await runHook({ cwd: work, env: { HOME: home, HASHLINE_ENFORCE: "1" } });
      expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
