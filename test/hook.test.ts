import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const BLOCK = path.join(import.meta.dir, "..", "hooks", "scripts", "block-edit.ts");
const NUDGE = path.join(import.meta.dir, "..", "hooks", "scripts", "nudge.ts");

async function run(script: string, opts: { env?: Record<string, string>; cwd?: string }): Promise<string> {
  const proc = Bun.spawn(["bun", script], {
    cwd: opts.cwd,
    env: { PATH: process.env.PATH ?? "", ...opts.env },
    stdin: new TextEncoder().encode(JSON.stringify({ cwd: opts.cwd })),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("block hook — enforce-by-default with opt-out (R7/R9)", () => {
  test("denies by default when the project has NOT opted out", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      const out = await run(BLOCK, { cwd: work, env: { HOME: "/nonexistent-home" } });
      const json = JSON.parse(out);
      expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/hashline edit tool/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("a .hashline-off marker in cwd opts out (allow)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      writeFileSync(path.join(work, ".hashline-off"), "");
      const out = await run(BLOCK, { cwd: work, env: { HOME: "/nonexistent-home" } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("a .hashline-off marker in an ancestor directory opts out (allow)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "hashline-root-"));
    try {
      writeFileSync(path.join(root, ".hashline-off"), "");
      const sub = path.join(root, "pkg", "src");
      mkdirSync(sub, { recursive: true });
      const out = await run(BLOCK, { cwd: sub, env: { HOME: "/nonexistent-home" } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("HASHLINE_DISABLED=1 opts out (R9, out-of-band recovery)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      const out = await run(BLOCK, { cwd: work, env: { HOME: "/nonexistent-home", HASHLINE_DISABLED: "1" } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("a HOME-trusted ~/.hashline-off sentinel opts out", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    const home = mkdtempSync(path.join(tmpdir(), "hashline-home-"));
    try {
      writeFileSync(path.join(home, ".hashline-off"), "");
      const out = await run(BLOCK, { cwd: work, env: { HOME: home } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("nudge hook — SessionStart positive reinforcement", () => {
  test("emits hashline steer where enforcement is active (default)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      const out = await run(NUDGE, { cwd: work, env: { HOME: "/nonexistent-home" } });
      const json = JSON.parse(out);
      expect(json.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(json.hookSpecificOutput.additionalContext).toMatch(/hashline edit tool/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  test("stays silent where the repo opted out", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    try {
      writeFileSync(path.join(work, ".hashline-off"), "");
      const out = await run(NUDGE, { cwd: work, env: { HOME: "/nonexistent-home" } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
