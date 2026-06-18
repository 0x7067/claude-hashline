import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function cwdFromPayload(payload: string): string {
  const parsed = JSON.parse(payload) as { cwd?: unknown };
  if (typeof parsed.cwd !== "string" || !parsed.cwd) throw new Error("Hook payload missing cwd");
  return parsed.cwd;
}

export function hashlineEnforced(payload: string): boolean {
  const home = os.homedir();
  if (process.env.HASHLINE_DISABLED || (home && existsSync(path.join(home, ".hashline-off")))) return false;

  let dir = path.resolve(cwdFromPayload(payload));
  for (;;) {
    if (existsSync(path.join(dir, ".hashline-off"))) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return true;
    dir = parent;
  }
}

// hashline only governs files in the project tree; edits to /tmp, $HOME dotfiles,
// etc. are outside its jurisdiction and must not be blocked.
export function targetInProject(payload: string): boolean {
  const parsed = JSON.parse(payload) as { cwd?: string; tool_input?: Record<string, unknown> };
  const target = parsed.tool_input?.file_path ?? parsed.tool_input?.notebook_path;
  if (typeof target !== "string" || !target) return true; // no path → fall back to enforcing
  const cwd = path.resolve(parsed.cwd ?? "");
  const resolved = path.resolve(cwd, target);
  return resolved === cwd || resolved.startsWith(cwd + path.sep);
}

export async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}
