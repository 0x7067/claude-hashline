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

export async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}
