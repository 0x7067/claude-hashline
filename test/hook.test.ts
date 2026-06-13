import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("block hook (R7/R9)", () => {
  test("denies by default with a redirect naming the hashline tool", async () => {
    const out = await runHook({ env: { HOME: "/nonexistent-home" } });
    const json = JSON.parse(out);
    expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/hashline edit tool/);
  });

  test("HASHLINE_DISABLED env var allows the call through (R9)", async () => {
    const out = await runHook({ env: { HOME: "/nonexistent-home", HASHLINE_DISABLED: "1" } });
    expect(out.trim()).toBe("");
  });

  test("a trusted-dir (HOME) sentinel allows the call through", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "hashline-home-"));
    try {
      writeFileSync(path.join(home, ".hashline-off"), "");
      const out = await runHook({ env: { HOME: home } });
      expect(out.trim()).toBe("");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a cwd .hashline-off does NOT bypass the block (SEC-003)", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "hashline-cwd-"));
    const home = mkdtempSync(path.join(tmpdir(), "hashline-home-"));
    try {
      writeFileSync(path.join(work, ".hashline-off"), "");
      const out = await runHook({ cwd: work, env: { HOME: home } });
      const json = JSON.parse(out);
      expect(json.hookSpecificOutput.permissionDecision).toBe("deny");
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
