/**
 * Benchmark arms (R12) and the claude-p invocation (R11/R13/R14 capture).
 * The claude-p call is isolated in `runClaudeP` as the single swap point for a
 * `claude -p` / Agent SDK fallback (no separate adapter file until a second
 * backend exists). claude-p's forwarding of an MCP-namespace glob to
 * --disallowedTools is unverified (feas-05), so the control arm enumerates both
 * concrete tool names alongside the glob.
 */
export type Arm = "hashline" | "control" | "familiarity";

const HASHLINE_TOOLS = [
  "mcp__plugin_claude-hashline_hashline__read",
  "mcp__plugin_claude-hashline_hashline__edit",
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
      return [...HASHLINE_TOOLS, "mcp__plugin_claude-hashline_hashline__*"];
    case "familiarity":
      // Optional arm (adv-02): hashline engine, but the model also keeps the
      // built-ins disallowed; the difference vs. hashline is a familiar tool
      // name / warm-up applied at the workspace layer, decided in the pilot.
      return ["Edit", "Write", "NotebookEdit"];
  }
}

export interface ClaudePOptions {
  cwd: string;
  model: string;
  maxTurns: number;
  disallowedTools: string[];
  prompt: string;
  /** Override the binary (tests inject a fake). Default: "claude-p". */
  bin?: string;
}

export interface ClaudePResult {
  exitCode: number;
  /** Raw transcript text (stream-json / jsonl) captured from stdout. */
  transcript: string;
  /** True when the runner could not execute (binary missing, etc.). */
  unavailable: boolean;
  error?: string;
}

/** Single swap point: invoke claude-p headless. Never throws — failures are recorded. */
export async function runClaudeP(opts: ClaudePOptions): Promise<ClaudePResult> {
  const bin = opts.bin ?? "claude-p";
  const args = [
    "--cwd", opts.cwd,
    "--model", opts.model,
    "--max-turns", String(opts.maxTurns),
    "--output-format", "stream-json",
    ...opts.disallowedTools.flatMap(t => ["--disallowedTools", t]),
    "-p", opts.prompt,
  ];
  try {
    const proc = Bun.spawn([bin, ...args], { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" });
    const transcript = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { exitCode, transcript, unavailable: false };
  } catch (err) {
    return { exitCode: -1, transcript: "", unavailable: true, error: err instanceof Error ? err.message : String(err) };
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
];

/**
 * Parse a stream-json / jsonl transcript for output tokens, tool-failure count,
 * and turn count. Tolerant of shape drift: scans each JSON line for known
 * fields rather than assuming a fixed schema.
 */
export function parseTranscript(transcript: string): TranscriptMetrics {
  let outputTokens = 0;
  let rejections = 0;
  let turns = 0;
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const usage = findUsage(obj);
    if (usage !== undefined) outputTokens += usage;
    if (isAssistant(obj)) turns += 1;
    if (isErrorToolResult(obj) || markerHit(trimmed)) rejections += 1;
  }
  return { outputTokens, rejections, turns };
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
