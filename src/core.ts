/**
 * Hashline read/edit adapters over @oh-my-pi/hashline, decoupled from MCP so
 * tests drive them directly. The snapshot store and jailed filesystem are
 * per-process singletons (one Claude Code session == one server process), so
 * `read` and a later `edit` share snapshot state across MCP calls (KTD5).
 */
import {
  computeFileHash,
  formatHashlineHeader,
  formatNumberedLines,
  InMemorySnapshotStore,
  isNotFound,
  normalizeToLF,
  Patch,
  Patcher,
  type SnapshotStore,
  stripBom,
} from "@oh-my-pi/hashline";
import { readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { JailedFilesystem, PathEscapeError } from "./jailed-fs.ts";

export interface HashlineContext {
  fs: JailedFilesystem;
  snapshots: SnapshotStore;
  patcher: Patcher;
  root: string;
}

/** Build a fresh context rooted at `root` (defaults to HASHLINE_ROOT or cwd). */
export function createContext(root: string = process.env.HASHLINE_ROOT ?? process.cwd()): HashlineContext {
  const fs = new JailedFilesystem(root);
  const snapshots = new InMemorySnapshotStore();
  // No blockResolver: tree-sitter `block` ops are out of v1 (KTD1), so they
  // throw on apply. The adapted tool description never emits them.
  const patcher = new Patcher({ fs, snapshots });
  return { fs, snapshots, patcher, root: fs.root };
}

const DEFAULT_MAX_READ_LINES = 2000;

/** True if `absPath` exists and is a directory (false on any stat error). */
function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

export interface ReadArgs {
  path: string;
  /** 1-indexed start line. */
  offset?: number;
  /** Max lines to return from `offset`. */
  limit?: number;
}

/**
 * Read a file, record a whole-file snapshot under the canonical absolute path
 * (so the edit-time lookup matches — feas-04), and return the hashline-tagged
 * view: a `[PATH#TAG]` header followed by `LINE:TEXT` rows (R1).
 */
export async function hashlineRead(ctx: HashlineContext, args: ReadArgs): Promise<string> {
  // Directory listing: if `path` is a directory, list its files instead of
  // dead-ending on a misleading "File not found" file-read. The dominant
  // genuine failure in the benchmark is models probing `read "."` to discover
  // the target file; returning the listing makes that probe self-correcting.
  const resolved = ctx.fs.canonicalPath(args.path); // throws PathEscapeError if it escapes
  if (isDirectory(resolved)) {
    const entries = readdirSync(resolved, { withFileTypes: true })
      .filter(e => e.isFile())
      .map(e => e.name)
      .sort();
    return `'${args.path}' is a directory, not a file. Files here: ${entries.join(", ") || "(none)"}\nRead a specific file to get its \`[PATH#TAG]\` and edit it.`;
  }

  const raw = await ctx.fs.readText(args.path); // throws NotFoundError / PathEscapeError
  const normalized = normalizeToLF(stripBom(raw).text);
  const key = ctx.fs.canonicalPath(args.path);
  const hash = ctx.snapshots.record(key, normalized);

  const allLines = normalized.split("\n");
  const start = args.offset && args.offset > 0 ? args.offset : 1;
  const maxLines = args.limit && args.limit > 0 ? args.limit : DEFAULT_MAX_READ_LINES;
  const end = Math.min(allLines.length, start - 1 + maxLines);
  const slice = allLines.slice(start - 1, end).join("\n");

  const header = formatHashlineHeader(args.path, hash);
  const body = formatNumberedLines(slice, start);
  const remaining = allLines.length - end;
  const tail = remaining > 0 ? `\n... ${remaining} more line(s); re-read with offset=${end + 1}` : "";
  return `${header}\n${body}${tail}`;
}

// Context window defaults mirror oh-my-pi's `search` tool (search.contextBefore
// = 1, search.contextAfter = 3): a hit shows one line above and three below.
const SEARCH_CONTEXT_BEFORE = 1;
const SEARCH_CONTEXT_AFTER = 3;
/** Default cap on total emitted match lines across all files. */
const DEFAULT_MAX_SEARCH_RESULTS = 50;
/** Skip files larger than this (bytes) — binaries/minified blobs aren't editable views. */
const MAX_SEARCH_FILE_BYTES = 1_000_000;
/** Per-line column cap; longer lines are truncated with `…` (oh-my-pi maxColumns). */
const MAX_SEARCH_COLUMNS = 512;
/** Directory names never descended into during a search walk. */
const SEARCH_SKIP_DIRS = new Set(["node_modules", ".git"]);

export interface SearchArgs {
  /** Regex source matched per line. */
  pattern: string;
  /** Case-insensitive search (oh-my-pi `i`). */
  i?: boolean;
  /** Cap on total match lines returned (default 50). */
  maxResults?: number;
}

/**
 * Format one search row, mirroring oh-my-pi's `formatMatchLine` in hashline
 * mode: a match line is prefixed `*`, a context line a single space, so line
 * numbers stay column-aligned. Numbers are never padded. Over-long lines are
 * truncated to MAX_SEARCH_COLUMNS with a trailing `…`.
 */
function formatMatchLine(lineNumber: number, line: string, isMatch: boolean): string {
  const text = line.length > MAX_SEARCH_COLUMNS ? `${line.slice(0, MAX_SEARCH_COLUMNS)}…` : line;
  return `${isMatch ? "*" : " "}${lineNumber}:${text}`;
}

/** Recursively collect editable files under `dir`, skipping node_modules and
 * dot-directories (mirrors `bench/generate.ts` walk). Returns absolute paths. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SEARCH_SKIP_DIRS.has(name)) continue;
      out.push(...walkFiles(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Merge 0-based hit indices into inclusive [start, end] windows padded by
 * SEARCH_CONTEXT_BEFORE/AFTER, collapsing overlapping/adjacent windows. */
function mergeWindows(hits: number[], lineCount: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  for (const i of hits) {
    const a = Math.max(0, i - SEARCH_CONTEXT_BEFORE);
    const b = Math.min(lineCount - 1, i + SEARCH_CONTEXT_AFTER);
    const last = windows[windows.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else windows.push([a, b]);
  }
  return windows;
}

/**
 * Search the workspace for `pattern` and return matches grouped per file under
 * the engine's `[PATH#TAG]` header with windowed `LINE:TEXT` rows (R1, R2). Each
 * matched file gets a recorded whole-file snapshot (R3) so the model can `edit`
 * straight off a hit with no prior `read`. Walk and snapshot keys stay inside the
 * workspace jail (R5). Unmatched files are never recorded (KTD2).
 */
export async function hashlineSearch(ctx: HashlineContext, args: SearchArgs): Promise<string> {
  const re = new RegExp(args.pattern, args.i ? "i" : ""); // throws on invalid pattern (server wraps to isError)
  const cap = args.maxResults && args.maxResults > 0 ? args.maxResults : DEFAULT_MAX_SEARCH_RESULTS;

  const blocks: string[] = [];
  let total = 0;
  let truncated = false;

  for (const abs of walkFiles(ctx.root).sort()) {
    if (truncated) break;
    let size: number;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }
    if (size > MAX_SEARCH_FILE_BYTES) continue;

    const rel = path.relative(ctx.root, abs);
    let raw: string;
    try {
      raw = await ctx.fs.readText(rel);
    } catch {
      continue; // unreadable / escaped — skip silently
    }
    const normalized = normalizeToLF(stripBom(raw).text);
    const lines = normalized.split("\n");

    const hitSet = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) hitSet.add(i);
    }
    if (hitSet.size === 0) continue;
    const hits = [...hitSet];

    // Match-gated snapshot: only matched files are recorded (KTD2/R3).
    const key = ctx.fs.canonicalPath(rel);
    const hash = ctx.snapshots.record(key, normalized);

    const rows: string[] = [];
    for (const [a, b] of mergeWindows(hits, lines.length)) {
      for (let i = a; i <= b; i++) rows.push(formatMatchLine(i + 1, lines[i], hitSet.has(i)));
      total += hits.filter(h => h >= a && h <= b).length;
      if (total >= cap) {
        // A window is atomic, so the cap is a floor, not an exact count: render
        // the window in full, then stop. More matches exist beyond this point.
        truncated = true;
        break;
      }
    }
    blocks.push(`${formatHashlineHeader(rel, hash)}\n${rows.join("\n")}`);
  }

  if (blocks.length === 0) return "No matches found";
  const tail = truncated ? `\n\n... results truncated at ${cap} matches; narrow your pattern.` : "";
  return `${blocks.join("\n\n")}${tail}`;
}

export interface EditResult {
  text: string;
  isError: boolean;
}

const TAGLESS_CREATE_HEADER = /^\[([^\]#]+)\]\s*$/;

/**
 * Apply a hashline patch (R3). Runs three adapter-side gates the package does
 * not — path containment (KTD9), read-before-edit (R6/feas-03), and new-file
 * creation (R4/KTD10) — then delegates to the package Patcher for existing
 * files (stale-tag recovery/rejection comes from the package, R5).
 */
export async function hashlineEdit(ctx: HashlineContext, input: string): Promise<EditResult> {
  // Pre-scan for tagless create headers (`[path]` with no `#TAG`): the package
  // requires a tag and has no create path, so the adapter handles creation.
  const createSections = scanTaglessCreateSections(input);
  if (createSections.length > 0) {
    try {
      return await handleCreates(ctx, createSections);
    } catch (err) {
      return { text: errMessage(err), isError: true };
    }
  }

  let patch: Patch;
  try {
    patch = Patch.parse(input, { cwd: ctx.root });
  } catch (err) {
    return { text: errMessage(err), isError: true };
  }
  if (patch.sections.length === 0) {
    return { text: "No hashline sections found in input. A section starts with `[PATH#TAG]`.", isError: true };
  }

  // Gate every section before any write.
  for (const section of patch.sections) {
    try {
      ctx.fs.resolveInside(section.path); // KTD9 containment (throws PathEscapeError)
    } catch (err) {
      return { text: errMessage(err), isError: true };
    }
    const key = ctx.fs.canonicalPath(section.path);
    const exists = await ctx.fs.exists(section.path);
    if (!exists) {
      return {
        text:
          `Cannot edit '${section.path}': file does not exist. ` +
          `To create it, send a tagless header \`[${section.path}]\` followed by \`insert head:\` and the file body.`,
        isError: true,
      };
    }
    if (ctx.snapshots.head(key) === null) {
      // R6/feas-03: the package would apply a live-matching tag with no prior
      // read; the adapter refuses so anchors are always read-derived.
      return {
        text: `Refusing to edit '${section.path}': no hashline read recorded this session. Read it first to get a current \`[PATH#TAG]\`.`,
        isError: true,
      };
    }
  }

  try {
    const result = await ctx.patcher.apply(patch);
    const blocks = result.sections
      .map(s => (s.op === "noop" ? `${s.path}: no change` : `${s.header} (${s.op})`))
      .join("\n");
    return { text: blocks, isError: false };
  } catch (err) {
    return { text: errMessage(err), isError: true };
  }
}

interface CreateSection {
  path: string;
  body: string;
}

/** Find `[path]`-only sections (no `#TAG`) and their `insert head/tail:` body. */
function scanTaglessCreateSections(input: string): CreateSection[] {
  const lines = input.split("\n");
  const out: CreateSection[] = [];
  let current: { path: string; body: string[] } | null = null;
  let collecting = false;
  for (const line of lines) {
    const header = TAGLESS_CREATE_HEADER.exec(line);
    if (header) {
      if (current) out.push({ path: current.path, body: current.body.join("\n") });
      current = { path: header[1].trim(), body: [] };
      collecting = false;
      continue;
    }
    if (!current) continue;
    if (/^insert (head|tail):\s*$/.test(line)) {
      collecting = true;
      continue;
    }
    if (collecting && line.startsWith("+")) current.body.push(line.slice(1));
  }
  if (current) out.push({ path: current.path, body: current.body.join("\n") });
  // Only treat as creates the sections that actually carried a body.
  return out.filter(s => s.body.length > 0);
}

async function handleCreates(ctx: HashlineContext, sections: CreateSection[]): Promise<EditResult> {
  const headers: string[] = [];
  for (const s of sections) {
    ctx.fs.resolveInside(s.path); // KTD9
    if (await ctx.fs.exists(s.path)) {
      return {
        text: `Cannot create '${s.path}': it already exists. Read it and use a tagged edit instead.`,
        isError: true,
      };
    }
    const content = s.body.endsWith("\n") ? s.body : `${s.body}\n`;
    await ctx.fs.writeText(s.path, content);
    const key = ctx.fs.canonicalPath(s.path);
    const hash = ctx.snapshots.record(key, normalizeToLF(content));
    void computeFileHash; // hash already via record()
    headers.push(`${formatHashlineHeader(s.path, hash)} (create)`);
  }
  return { text: headers.join("\n"), isError: false };
}

function errMessage(err: unknown): string {
  if (err instanceof PathEscapeError) return err.message;
  if (isNotFound(err)) return err instanceof Error ? err.message : String(err);
  return err instanceof Error ? err.message : String(err);
}
