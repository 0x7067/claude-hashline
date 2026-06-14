/**
 * ripgrep subprocess adapter. Spawns the bundled `rg` binary (@vscode/ripgrep)
 * and streams its `--json` output as typed messages. `hashlineSearch` consumes
 * these to render `[PATH#TAG]` blocks; ripgrep replaces the former in-process
 * file walk + JS-RegExp match. A linear-time RE2 engine, so model-supplied
 * patterns cannot catastrophically backtrack (the ReDoS class is gone).
 */
import { rgPath } from "@vscode/ripgrep";

/** A line/text payload in an rg `--json` message. `text` is absent when rg could
 * not decode the bytes as UTF-8 (rg emits `{bytes: ...}` instead); we skip those. */
interface RgText {
  text?: string;
}

export interface RgBegin {
  type: "begin";
  data: { path: RgText };
}
export interface RgMatch {
  type: "match";
  data: { path: RgText; lines: RgText; line_number: number; submatches: Array<{ start: number; end: number }> };
}
export interface RgContext {
  type: "context";
  data: { path: RgText; lines: RgText; line_number: number };
}
export interface RgEnd {
  type: "end";
  data: { path: RgText };
}
export type RipgrepMessage = RgBegin | RgMatch | RgContext | RgEnd;

const KNOWN_TYPES = new Set(["begin", "match", "context", "end"]);

export interface RunRipgrepOptions {
  /** Args after the binary: flags, `-e <pattern>`, then path(s). */
  argv: string[];
  /** Working directory for the search (the workspace-jail root). */
  cwd: string;
  /** Binary path override (defaults to the bundled rg); injectable for tests. */
  bin?: string;
}

/** Parse one stdout line into a known message, or null for blank/non-JSON/
 * unknown-type lines (rg also emits a `summary` message we don't consume). */
function parseLine(line: string): RipgrepMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return null; // non-JSON noise — skip rather than crash the stream
  }
  if (!msg || typeof msg !== "object") return null;
  const t = (msg as { type?: unknown }).type;
  if (typeof t !== "string" || !KNOWN_TYPES.has(t)) return null;
  return msg as RipgrepMessage;
}

/**
 * Spawn ripgrep and yield its `--json` messages as they stream. Exit code 1
 * (no matches) ends the stream cleanly; exit code >= 2, or a failure to spawn
 * the binary at all, throws a clear, actionable error (R7). If the consumer
 * stops early (e.g. a result cap), the process is killed in `finally`.
 */
export async function* runRipgrep(opts: RunRipgrepOptions): AsyncGenerator<RipgrepMessage> {
  const bin = opts.bin ?? rgPath;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([bin, ...opts.argv], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    throw new Error(`Could not spawn ripgrep at ${bin}: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const msg = parseLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (msg) yield msg;
      }
    }
    const tail = parseLine(buf);
    if (tail) yield tail;

    const code = await proc.exited;
    if (code >= 2) {
      const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
      throw new Error(`ripgrep failed (exit ${code}): ${stderr.trim() || "unknown error"}`);
    }
  } finally {
    // Consumer broke early (result cap) — don't leave rg running.
    if (proc.exitCode === null) proc.kill();
  }
}
