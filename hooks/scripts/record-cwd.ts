import { mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readStdin } from "./lib-enforce.ts";

// PreToolUse hook for the hashline MCP tools. The MCP server process is pinned
// to the cwd it was launched with and Claude Code never tells it the session
// moved (no roots update, no cwd env var on a git-worktree / `/cd` switch). So
// without this the server keeps editing the original repo even after the session
// enters a worktree. Hooks DO receive the live `cwd`, and a PreToolUse hook runs
// and blocks before the tool executes — so we stash cwd here and the server reads
// it back (see liveCwd in src/core.ts). Keyed by session_id so concurrent
// sessions don't clobber each other.
const payload = JSON.parse(await readStdin()) as { cwd?: string; session_id?: string };
if (payload.cwd && payload.session_id) {
  const dir = path.join(os.tmpdir(), "claude-hashline-cwd");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, payload.session_id), payload.cwd);
}
