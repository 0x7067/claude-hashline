/**
 * Benchmark arms (R12) and the model invocation (R11/R13/R14 capture).
 *
 * Backend: the real `claude -p` headless CLI (verified to stream per-message
 * `tool_use`/`tool_result` lines plus an authoritative trailing `result`
 * envelope with real token usage and `num_turns`). `claude-p` (the PTY
 * emulator) was evaluated and rejected: it reports `usage: 0` in every output
 * format because the transcript it captures lacks per-message usage lines, and
 * the token-waste metric is the benchmark's headline. The call is isolated in
 * `runClaude` as the single swap point for an Agent-SDK backend later.
 *
 * The benchmark loads the hashline MCP server via `--mcp-config` (NOT plugin
 * loading), so the tool namespace is `mcp__hashline__*`, not the plugin form
 * `mcp__plugin_claude-hashline_hashline__*`. The control arm enumerates both
 * concrete hashline tool names AND the server glob because glob support in
 * `--disallowedTools` is environment-dependent (feas-05).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
export type Arm = "hashline" | "control" | "familiarity";

/** MCP server name as loaded via --mcp-config; defines the tool namespace. */
export const HASHLINE_SERVER = "hashline";
const HASHLINE_TOOLS = [
  `mcp__${HASHLINE_SERVER}__read`,
  `mcp__${HASHLINE_SERVER}__edit`,
];

/** Tools to disallow for an arm. */
export function disallowedToolsFor(arm: Arm): string[] {
  switch (arm) {
    case "hashline":
      // Force the model onto the hashline MCP tools.
      return ["Edit", "Write", "NotebookEdit"];
    case "control":
      // The real default: built-in editor allowed, hashline suppressed.
      // Enumerate both names AND the glob (feas-05: glob support unverified).
      return [...HASHLINE_TOOLS, `mcp__${HASHLINE_SERVER}__*`];
    case "familiarity":
      // Optional arm (adv-02): hashline engine, but the model also keeps the
      // built-ins disallowed; the difference vs. hashline is a familiar tool
      // name / warm-up applied at the workspace layer, decided in the pilot.
      return ["Edit", "Write", "NotebookEdit"];
  }
}

/** Arms that need the hashline MCP server loaded (so the model can edit at all). */
export function armNeedsHashlineServer(arm: Arm): boolean {
  return arm === "hashline" || arm === "familiarity";
}

export interface ClaudePOptions {
  cwd: string;
  model: string;
  maxTurns: number;
  disallowedTools: string[];
  prompt: string;
  /**
   * Absolute path to the hashline MCP server entry (`src/server.ts`). When set
   * and the arm needs it, a per-run `--mcp-config` is generated that launches
   * the server with `HASHLINE_ROOT` pinned to the workspace.
   */
  serverPath?: string;
  /** Whether this arm needs the hashline MCP server loaded. */
  needsHashlineServer?: boolean;
  /** Override the binary (tests inject a fake). Default: "claude". */
  bin?: string;
}

export interface ClaudePResult {
  exitCode: number;
  /** Raw transcript text (stream-json jsonl) captured from stdout. */
  transcript: string;
  /** True when the runner could not execute (binary missing, etc.). */
  unavailable: boolean;
  error?: string;
}

/**
 * Build a per-run MCP config that launches the hashline server jailed to the
 * workspace. Returned path must be cleaned up by the caller.
 */
function writeMcpConfig(cwd: string, serverPath: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hashline-mcp-"));
  const cfgPath = path.join(dir, "mcp.json");
  const cfg = {
    mcpServers: {
      [HASHLINE_SERVER]: {
        command: "bun",
        args: ["run", serverPath],
        env: { HASHLINE_ROOT: cwd },
      },
    },
  };
  writeFileSync(cfgPath, JSON.stringify(cfg));
  return cfgPath;
}

/**
 * Single swap point: invoke `claude -p` headless and capture the stream-json
 * transcript. Never throws — failures are recorded as `unavailable`.
 *
 * The prompt is fed on stdin (not a positional arg) so the variadic
 * `--disallowedTools` cannot greedily consume it, and so multiline task
 * descriptions need no shell escaping.
 */
export async function runClaudeP(opts: ClaudePOptions): Promise<ClaudePResult> {
  const bin = opts.bin ?? "claude";
  const useServer = opts.needsHashlineServer && opts.serverPath;
  let mcpConfigPath: string | undefined;
  try {
    if (useServer) mcpConfigPath = writeMcpConfig(opts.cwd, opts.serverPath!);
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--model", opts.model,
      "--max-turns", String(opts.maxTurns),
      // Isolated throwaway workspace: bypass interactive permission prompts so
      // MCP and built-in tools run unattended. `--disallowedTools` is a hard
      // filter that still applies under this mode (verified in the pilot).
      "--dangerously-skip-permissions",
      // Only the injected config's servers load — never the operator's user/
      // project MCP servers (basic-memory, etc.), which would pollute the run.
      ...(mcpConfigPath ? ["--mcp-config", mcpConfigPath, "--strict-mcp-config"] : []),
      // Variadic flag kept LAST so its tool list runs to end-of-args; the
      // prompt is on stdin, so nothing downstream is mis-consumed.
      ...(opts.disallowedTools.length ? ["--disallowedTools", ...opts.disallowedTools] : []),
    ];
    const proc = Bun.spawn([bin, ...args], {
      cwd: opts.cwd,
      stdin: new TextEncoder().encode(opts.prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
    const transcript = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { exitCode, transcript, unavailable: false };
  } catch (err) {
    return { exitCode: -1, transcript: "", unavailable: true, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (mcpConfigPath) rmSync(path.dirname(mcpConfigPath), { recursive: true, force: true });
  }
}

export interface TranscriptMetrics {
  outputTokens: number;
  /** Count of failed tool calls (edit rejections, "string not found", etc.). */
  rejections: number;
  /** Number of assistant turns observed. */
  turns: number;
}

const REJECTION_MARKERS = [
  /String to replace not found/i,
  /does not match the current file/i,
  /Refusing to edit/i,
  /no hashline read recorded/i,
  /outside the workspace/i,
  /could not resolve/i,
  // A blocked built-in editor (hashline arm) surfaces this exact shape; it is
  // already caught by isErrorToolResult, but the marker documents the intent.
  /No such tool available|not enabled in this context/i,
];

/**
 * Parse a stream-json jsonl transcript for output tokens, tool-failure count,
 * and turn count. Tolerant of shape drift: scans each JSON line for known
 * fields rather than assuming a fixed schema.
 *
 * The trailing `result` envelope is authoritative for tokens and turns when
 * present (claude reports cumulative `usage` and `num_turns` there), so we use
 * it and do NOT also sum per-assistant usage (which would double-count).
 * Rejections always come from scanning the stream — the result envelope's
 * `permission_denials` (blocked built-in attempts) plus every errored
 * `tool_result` (e.g. "String to replace not found", hashline tag mismatch),
 * since those failures never appear in the final envelope.
 */
export function parseTranscript(transcript: string): TranscriptMetrics {
  let summedTokens = 0;
  let assistantTurns = 0;
  let rejections = 0;
  let resultTokens: number | undefined;
  let resultTurns: number | undefined;

  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isResult(obj)) {
      const rec = obj as Record<string, unknown>;
      const usage = rec.usage as Record<string, unknown> | undefined;
      if (typeof usage?.output_tokens === "number") resultTokens = usage.output_tokens;
      if (typeof rec.num_turns === "number") resultTurns = rec.num_turns;
      const denials = rec.permission_denials;
      if (Array.isArray(denials)) rejections += denials.length;
      continue; // don't also sum the result line's usage
    }
    const usage = findUsage(obj);
    if (usage !== undefined) summedTokens += usage;
    if (isAssistant(obj)) assistantTurns += 1;
    if (isErrorToolResult(obj) || markerHit(trimmed)) rejections += 1;
  }

  return {
    outputTokens: resultTokens ?? summedTokens,
    turns: resultTurns ?? assistantTurns,
    rejections,
  };
}

function isResult(obj: unknown): boolean {
  return !!obj && typeof obj === "object" && (obj as Record<string, unknown>).type === "result";
}

function findUsage(obj: unknown): number | undefined {
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const msg = rec.message as Record<string, unknown> | undefined;
    const usage = (msg?.usage ?? rec.usage) as Record<string, unknown> | undefined;
    const out = usage?.output_tokens;
    if (typeof out === "number") return out;
  }
  return undefined;
}

function isAssistant(obj: unknown): boolean {
  return !!obj && typeof obj === "object" && (obj as Record<string, unknown>).type === "assistant";
}

function isErrorToolResult(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const content = (obj as Record<string, unknown>).message;
  const arr = (content as Record<string, unknown> | undefined)?.content;
  if (!Array.isArray(arr)) return false;
  return arr.some(c => c && typeof c === "object" && (c as Record<string, unknown>).type === "tool_result" && (c as Record<string, unknown>).is_error === true);
}

function markerHit(line: string): boolean {
  return REJECTION_MARKERS.some(re => re.test(line));
}
