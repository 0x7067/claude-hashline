/**
 * Hashline read/edit adapters over @oh-my-pi/hashline, decoupled from MCP so
 * tests drive them directly. The snapshot store and jailed filesystem are
 * per-process singletons (one Claude Code session == one server process), so
 * `read` and a later `edit` share snapshot state across MCP calls (KTD5).
 */
import {
  formatHashlineHeader,
  formatNumberedLines,
  InMemorySnapshotStore,
  isNotFound,
  normalizeToLF,
  Patch,
  Patcher,
  type SnapshotStore,
  splitAddressableFileLines,
  stripBom,
  buildCompactDiffPreview,
  type BlockResolution,
} from "@oh-my-pi/hashline";
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalize, JailedFilesystem, PathEscapeError } from "./jailed-fs.ts";
import { buildRipgrepArgs, runRipgrep } from "./ripgrep.ts";
import { type ChangedSection, recordEditSaving } from "./savings.ts";
import { generateDiffString } from "./diff.ts";

/** fs + patcher pinned to one root, sharing the context's snapshot store. */
export interface RootBinding {
  fs: JailedFilesystem;
  patcher: Patcher;
  root: string;
}

export interface HashlineContext extends RootBinding {
  snapshots: SnapshotStore;
  /** Rebind fs+patcher to a different live root (git-worktree / `/cd` switch),
   *  reusing the shared snapshot store. Cached per resolved root. */
  rebind(root: string): RootBinding;
}

/**
 * Treat `"0"`, `"false"`, and empty/unset as off; anything else as on. Keeps the
 * env switch forgiving for the plugin (`"1"`) without enabling on a bare `""`.
 */
function envEnabled(v: string | undefined): boolean {
  if (v === undefined) return false;
  const t = v.trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

/**
 * Build a predicate that permits paths under Claude Code's per-project memory
 * dir: `<configDir>/projects/<slug>/memory[/**]`, for ANY project. The `<slug>`
 * segment is a wildcard, so no reproduction of Claude's cwd→slug encoding is
 * needed and it holds for every project (dots/spaces in the path included).
 * Honors `CLAUDE_CONFIG_DIR` (matching how the bench locates `~/.claude`).
 * Nothing else under `~/.claude` (transcripts, settings) is matched. Exported
 * for direct unit testing of the segment logic.
 */
export function claudeMemoryMatcher(): (resolved: string) => boolean {
  const configDir = canonicalize(path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")));
  const projectsBase = path.join(configDir, "projects");
  return (resolved: string): boolean => {
    if (resolved !== projectsBase && !resolved.startsWith(projectsBase + path.sep)) return false;
    const segs = path.relative(projectsBase, resolved).split(path.sep);
    // `<slug>/memory` or deeper; reject `projects/memory/...` (no slug segment).
    return segs.length >= 2 && segs[1] === "memory";
  };
}

/**
 * Build a predicate that permits paths under Claude Code's plans dir,
 * `<configDir>/plans[/**]`, so the model can write plan files. Honors
 * `CLAUDE_CONFIG_DIR` (default `~/.claude`), same as {@link claudeMemoryMatcher}.
 * Exported for direct unit testing.
 */
export function claudePlansMatcher(): (resolved: string) => boolean {
  const configDir = canonicalize(path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")));
  const plansBase = path.join(configDir, "plans");
  return (resolved: string): boolean => resolved === plansBase || resolved.startsWith(plansBase + path.sep);
}

/**
 * Build a predicate that permits paths under the system temp dir (`os.tmpdir()`,
 * honoring `HASHLINE_TMPDIR` for tests). Lets the model stage scratch files —
 * e.g. a PR body to feed `gh pr create --body-file` — instead of dead-ending on
 * the jail. The temp dir is ephemeral, world-writable scratch space, so the
 * widening is bounded. Exported for direct unit testing.
 */
export function systemTempMatcher(): (resolved: string) => boolean {
  const tmpBase = canonicalize(path.resolve(process.env.HASHLINE_TMPDIR ?? os.tmpdir()));
  return (resolved: string): boolean => resolved === tmpBase || resolved.startsWith(tmpBase + path.sep);
}

/**
 * Build a predicate permitting paths under any root listed in
 * `HASHLINE_ALLOW_PATHS` — a `path.delimiter`-separated list of absolute dirs
 * (a leading `~/` is expanded), e.g. a sibling repo or `~/.config`. Each entry
 * is canonicalized so the prefix check compares real paths (same symlink-safety
 * as the jail root). Operator-supplied and explicit — unlike `.hashline-off`,
 * repo contents can't inject a root. Empty/unset → undefined (no carve-out).
 * Exported for direct unit testing.
 */
export function explicitPathsMatcher(): ((resolved: string) => boolean) | undefined {
  const raw = process.env.HASHLINE_ALLOW_PATHS;
  if (!raw || !raw.trim()) return undefined;
  const roots = raw
    .split(path.delimiter)
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => canonicalize(path.resolve(p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p)));
  if (!roots.length) return undefined;
  return (resolved: string): boolean => roots.some(r => resolved === r || resolved.startsWith(r + path.sep));
}

/** Build a fresh context rooted at `root` (defaults to HASHLINE_ROOT or cwd). */
export function createContext(root: string = process.env.HASHLINE_ROOT ?? process.cwd()): HashlineContext {
  // Opt-in, additive carve-outs (each OR'd onto the in-root check): the Claude
  // memory dir (HASHLINE_ALLOW_MEMORY), the plans dir (HASHLINE_ALLOW_PLANS), the
  // system temp dir (HASHLINE_ALLOW_TMP), and an explicit operator-supplied root
  // list (HASHLINE_ALLOW_PATHS).
  const allows: Array<(resolved: string) => boolean> = [];
  if (envEnabled(process.env.HASHLINE_ALLOW_MEMORY)) allows.push(claudeMemoryMatcher());
  if (envEnabled(process.env.HASHLINE_ALLOW_PLANS)) allows.push(claudePlansMatcher());
  if (envEnabled(process.env.HASHLINE_ALLOW_TMP)) allows.push(systemTempMatcher());
  const explicit = explicitPathsMatcher();
  if (explicit) allows.push(explicit);
  const extraAllow = allows.length ? (resolved: string) => allows.some(fn => fn(resolved)) : undefined;
  const snapshots = new InMemorySnapshotStore();
  // No blockResolver: tree-sitter `block` ops are out of v1 (KTD1), so they
  // throw on apply. The adapted tool description never emits them.
  const cache = new Map<string, RootBinding>();
  const bind = (r: string): RootBinding => {
    const fs = new JailedFilesystem(r, extraAllow);
    const existing = cache.get(fs.root);
    if (existing) return existing;
    const binding: RootBinding = { fs, patcher: new Patcher({ fs, snapshots }), root: fs.root };
    cache.set(fs.root, binding);
    return binding;
  };
  const base = bind(root);
  return { ...base, snapshots, rebind: bind };
}

/**
 * The cwd the session is in *now*, as stashed by the record-cwd PreToolUse hook
 * (keyed by CLAUDE_CODE_SESSION_ID). Undefined when there's no session id (tests,
 * direct use) or no hook file — callers then fall back to the launch root. This
 * is how the jail follows a git-worktree / `/cd` switch the MCP protocol never
 * reports. Trusted: cwd comes from Claude Code's hook payload, not the model.
 */
function liveCwd(): string | undefined {
  const sid = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return undefined;
  try {
    const dir = readFileSync(path.join(os.tmpdir(), "claude-hashline-cwd", sid), "utf8").trim();
    return dir && isDirectory(dir) ? dir : undefined;
  } catch {
    return undefined; // no hook file yet
  }
}

/** A context view whose fs/patcher/root follow the session's live cwd (if it
 *  moved), keeping the shared snapshot store. Returned at the top of each tool so
 *  the body can keep using `ctx.fs`/`ctx.root` unchanged. */
function active(ctx: HashlineContext): HashlineContext {
  const live = liveCwd();
  return live ? { ...ctx, ...ctx.rebind(live) } : ctx;
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
export async function hashlineRead(ctx0: HashlineContext, args: ReadArgs): Promise<string> {
  const ctx = active(ctx0);
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
  const prev = ctx.snapshots.head(key);
  const hash = ctx.snapshots.record(key, normalized); // reuses tag if byte-identical (read fusion)

  // Re-read dedup: a bare re-read of a file unchanged since this session's last
  // snapshot re-emits nothing — the prior TAG is still valid, so an edit can
  // anchor to it directly. Pass offset/limit to force the body (e.g. after a
  // compaction dropped it). Saves the dominant token sink: redundant re-reads.
  if (prev && prev.hash === hash && !args.offset && !args.limit) {
    return `${formatHashlineHeader(args.path, hash)}\n(unchanged since last read this session; TAG ${hash} still valid — pass offset to view content)`;
  }

  // Address the same lines the patch engine does: a terminal newline terminates
  // the last line, it is not a blank line of its own. Numbering a phantom row
  // for it would show the model an anchor `CUT` silently no-ops on; appending is
  // `PUT >$:` instead.
  const allLines = splitAddressableFileLines(normalized);
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

/** Default cap on total emitted match lines across all files. */
const DEFAULT_MAX_SEARCH_RESULTS = 50;
/** Per-line column cap; longer lines are truncated with `…` (oh-my-pi maxColumns). */
const MAX_SEARCH_COLUMNS = 512;

export interface SearchArgs {
  /** Regex source matched per line. */
  pattern: string;
  /** Case-insensitive search (oh-my-pi `i`). */
  i?: boolean;
  /** Respect ignore files (`.gitignore`/`.ignore`), default true; mirrors oh-my-pi `gitignore`. */
  gitignore?: boolean;
  /** Scope the search to these workspace-relative subpaths; defaults to the whole tree. */
  paths?: string[];
  /** Multiline matching (ripgrep `-U`). */
  multiline?: boolean;
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

/** Strip ripgrep's leading `./` so the path is workspace-relative (rg prefixes
 * `.`-rooted searches; explicit path args come back unprefixed). */
function toWorkspaceRel(p: string | undefined): string | null {
  if (!p) return null;
  return p.startsWith("./") ? p.slice(2) : p;
}

/**
 * Search the workspace for `pattern` via ripgrep and return matches grouped per
 * file under the engine's `[PATH#TAG]` header with windowed `LINE:TEXT` rows
 * (R1, R2). Each matched file is full-read once to record a whole-file snapshot
 * (R3) so the model can `edit` straight off a hit with no prior `read`; only
 * matched files are recorded (KTD2). `paths` are jail-validated before the spawn
 * and ripgrep does not follow symlinks, so results stay inside the workspace
 * (R8). Pattern syntax is Rust/RE2 (no backreferences/lookbehind).
 */
export async function hashlineSearch(ctx0: HashlineContext, args: SearchArgs): Promise<string> {
  const ctx = active(ctx0);
  // R8: reject any `paths` entry that escapes the jail before spawning ripgrep.
  if (args.paths) for (const p of args.paths) ctx.fs.canonicalPath(p); // throws PathEscapeError

  const cap = args.maxResults && args.maxResults > 0 ? args.maxResults : DEFAULT_MAX_SEARCH_RESULTS;
  const argv = buildRipgrepArgs({
    pattern: args.pattern,
    i: args.i,
    gitignore: args.gitignore,
    multiline: args.multiline,
    paths: args.paths,
  });

  const blocks: string[] = [];
  let total = 0;
  let truncated = false;

  // ripgrep streams begin → match/context… → end per file, in path order.
  let rel: string | null = null;
  let hash: string | null = null;
  let rows: string[] = [];
  const flush = () => {
    if (rel !== null && hash !== null && rows.length > 0) {
      blocks.push(`${formatHashlineHeader(rel, hash)}\n${rows.join("\n")}`);
    }
    rel = null;
    hash = null;
    rows = [];
  };

  for await (const msg of runRipgrep({ argv, cwd: ctx.root })) {
    if (msg.type === "begin") {
      flush();
      const r = toWorkspaceRel(msg.data.path.text);
      if (!r) continue;
      let raw: string;
      try {
        raw = await ctx.fs.readText(r); // full-read the matched file
      } catch {
        continue; // unreadable / escaped — skip this file
      }
      const normalized = normalizeToLF(stripBom(raw).text);
      // Match-gated snapshot: only matched files are recorded (KTD2/R3).
      hash = ctx.snapshots.record(ctx.fs.canonicalPath(r), normalized);
      rel = r;
    } else if (msg.type === "match" || msg.type === "context") {
      if (rel === null) continue; // file was skipped at begin
      const text = (msg.data.lines.text ?? "").replace(/\r?\n$/, "");
      rows.push(formatMatchLine(msg.data.line_number, text, msg.type === "match"));
      if (msg.type === "match" && ++total >= cap) {
        truncated = true;
        flush();
        break;
      }
    } else if (msg.type === "end") {
      flush();
    }
  }
  flush(); // defensive: stream ended without a trailing `end`

  if (blocks.length === 0) return "No matches found";
  const tail = truncated ? `\n\n... results truncated at ${cap} matches; narrow your pattern.` : "";
  return `${blocks.join("\n\n")}${tail}`;
}

export interface EditResult {
  text: string;
  isError: boolean;
}

const TAGLESS_CREATE_HEADER = /^\[([^#\r\n]+)\]\s*$/; // greedy to last `]`; allows bracketed paths (app/[id]/page.tsx). `#` excluded so tagged headers fall through to the package.
const ANY_HEADER = /^\[[^\r\n]*\]\s*$/; // any header-shaped line, tagged or tagless — terminates a create body.

/** Range endpoints as models write them: `.=` (v18 canonical), `..` (v15), and
 *  the colon copied off a `read` row label. `-`/`…`/`=` are v18-lenient already
 *  but are folded here too so the legacy-verb rewrite below reaches them. */
const RANGE_SEP = String.raw`(?:\.=|\.\.|[.:\-=…])`;
/** A range as authored: `N`, or `N<sep>M`. Captures both endpoints. */
const RANGE = String.raw`(\d+)(?:\s*${RANGE_SEP}\s*(\d+))?`;

/** Canonical inclusive range: a lone `N` becomes `N.=N`. */
function canonRange(start: string, end: string | undefined): string {
  return `${start}.=${end ?? start}`;
}

/**
 * Rewrite ONE line into canonical v18 hunk-header syntax, if it is a hunk header
 * a model plausibly mis-spelled. Everything else — body rows, section headers,
 * prose, anything not matching a rule end-to-end — is returned byte-identical.
 *
 * Be liberal in what we accept (optimize-loop cycle 1, docs/benchmark/LEDGER.md).
 * Two measured/derived tolerances, both deterministic and idempotent:
 *
 * 1. LEGACY VERBS. v15's `replace`/`delete`/`insert before|after|head|tail` — the
 *    grammar this plugin taught until the v18 migration, and the one the
 *    benchmark was measured on — map onto v18's `PUT`/`CUT` forms. Models have
 *    habits; the v18 parser rejects the old verbs outright.
 * 2. COLON RANGES. Weak models copy the `N:` label from a `read` row into the
 *    header and write `PUT 23:23:` / `replace 12:14:` instead of a real range.
 *    That was 100% of the haiku arm's genuine edit-rejections on v15, and v18
 *    still refuses `:` as a range separator. A single-line `PUT 23:` (one number,
 *    nothing after the colon) is valid v18 and stays a single-line range.
 *
 * Deliberately NOT translated: the legacy tree-sitter block ops (`replace block
 * N:`, `delete block N`, `insert after block N:`). No block resolver is wired
 * (KTD1), so translating them would trade the parser's teaching error for a
 * resolver failure. They fall through and the engine says "use a concrete line
 * range".
 */
export function normalizeHunkHeaderLine(line: string): string {
  if (line.startsWith("+")) return line; // body row: never a header, never rewritten
  const m = /^(\s*)(\S.*?)\s*$/.exec(line);
  if (!m) return line;
  const [, indent, op] = m;

  const rewritten = ((): string | null => {
    let r: RegExpExecArray | null;
    // Legacy v15 verbs → v18 PUT/CUT.
    if ((r = new RegExp(String.raw`^replace\s+${RANGE}\s*:$`, "i").exec(op))) return `PUT ${canonRange(r[1], r[2])}:`;
    if ((r = new RegExp(String.raw`^delete\s+${RANGE}$`, "i").exec(op))) return `CUT ${canonRange(r[1], r[2])}`;
    if ((r = /^insert\s+before\s+(\d+)\s*:$/i.exec(op))) return `PUT <${r[1]}:`;
    if ((r = /^insert\s+after\s+(\d+)\s*:$/i.exec(op))) return `PUT >${r[1]}:`;
    if (/^insert\s+head\s*:$/i.test(op)) return "PUT <1:";
    if (/^insert\s+tail\s*:$/i.test(op)) return "PUT >$:";
    // Already a v18 hunk header: repair only what v18 actually refuses, so a
    // well-formed header comes back byte-identical.
    if ((r = /^(put|cut)(\s+[<>]?\s*[\d$].*)$/i.exec(op))) {
      const keyword = r[1].toUpperCase();
      // `PUT 12:14:` / `CUT 5:8` — the read-row colon copied in as a separator.
      const locator = r[2].replace(/^(\s*)(\d+):(\d+)/, "$1$2.=$3");
      return `${keyword}${locator}`;
    }
    return null;
  })();

  return rewritten === null || rewritten === op ? line : `${indent}${rewritten}`;
}

/**
 * Apply {@link normalizeHunkHeaderLine} to every line of a patch. Idempotent and
 * a strict no-op on input that is already valid v18 syntax.
 */
export function normalizeHunkHeaders(input: string): string {
  return input.split("\n").map(normalizeHunkHeaderLine).join("\n");
}

/**
 * Format a block resolution message for output.
 */
function formatBlockResolution(resolution: BlockResolution): string {
  return `[Resolved block ${resolution.anchorLine} to lines ${resolution.start}..${resolution.end}]`;
}

/**
 * Apply a hashline patch (R3). Runs three adapter-side gates the package does
 * not — path containment (KTD9), read-before-edit (R6/feas-03), and new-file
 * creation (R4/KTD10) — then delegates to the package Patcher for existing
 * files (stale-tag recovery/rejection comes from the package, R5). Tagless
 * create sections and tagged edit sections may be mixed in one call: tagged
 * sections apply first (they carry the rejectable gates — stale tag, no prior
 * read), then the pre-gated creates are written, so a rejected patch leaves
 * nothing half-done and the whole input can simply be resent.
 */
export async function hashlineEdit(ctx0: HashlineContext, input: string): Promise<EditResult> {
  const ctx = active(ctx0);
  // Split tagless create sections (`[path]` with no `#TAG`) out of the input:
  // the package requires a tag and has no create path, so the adapter handles
  // creation. A malformed create section is a hard error, never a silent drop.
  const scan = scanCreateSections(input);
  if (scan.error) return { text: scan.error, isError: true };

  if (scan.creates.length === 0) {
    const tagged = await applyTaggedSections(ctx, input);
    if (!tagged.isError) {
      // Track output tokens saved vs the str_replace a built-in edit would have emitted.
      recordEditSaving(ctx.root, input, tagged.changed);
    }
    return { text: tagged.text, isError: tagged.isError };
  }

  // Gate every create (containment, not-exists) before any write.
  try {
    for (const s of scan.creates) {
      ctx.fs.resolveInside(s.path); // KTD9 containment (throws PathEscapeError)
      if (await ctx.fs.exists(s.path)) {
        return {
          text: `Cannot create '${s.path}': it already exists. Read it and use a tagged edit instead.`,
          isError: true,
        };
      }
    }
  } catch (err) {
    return { text: errMessage(err), isError: true };
  }

  let taggedText = "";
  let taggedChanged: ChangedSection[] = [];
  if (scan.residual.trim() !== "") {
    const tagged = await applyTaggedSections(ctx, scan.residual);
    if (tagged.isError) return { text: tagged.text, isError: true }; // nothing written yet
    taggedText = tagged.text;
    taggedChanged = tagged.changed;
  }

  const headers: string[] = [];
  const contents: string[] = [];
  try {
    for (const s of scan.creates) {
      const content = s.body.endsWith("\n") ? s.body : `${s.body}\n`;
      await ctx.fs.writeText(s.path, content);
      contents.push(content);
      const key = ctx.fs.canonicalPath(s.path);
      const hash = ctx.snapshots.record(key, normalizeToLF(content));
      headers.push(`${formatHashlineHeader(s.path, hash)} (create)`);
    }
  } catch (err) {
    return { text: errMessage(err), isError: true };
  }

  // One ledger row for the whole call: a create emits the full body either way
  // (str_replace can't create), so its saving is ~0; tagged sections carry the win.
  recordEditSaving(ctx.root, input, [...taggedChanged, ...contents.map(c => ({ before: "", after: c }))]);
  return { text: [taggedText, headers.join("\n")].filter(Boolean).join("\n\n"), isError: false };
}

interface TaggedApplyResult extends EditResult {
  /** Pre/post text of each changed (non-noop) section, for savings accounting. */
  changed: ChangedSection[];
}

/** Parse, gate, and apply the tagged (`[PATH#TAG]`) sections of a patch. */
async function applyTaggedSections(ctx: HashlineContext, input: string): Promise<TaggedApplyResult> {
  let patch: Patch;
  try {
    patch = Patch.parse(normalizeHunkHeaders(input), { cwd: ctx.root });
  } catch (err) {
    return { text: errMessage(err), isError: true, changed: [] };
  }
  if (patch.sections.length === 0) {
    return { text: "No hashline sections found in input. A section starts with `[PATH#TAG]`.", isError: true, changed: [] };
  }

  // Gate every section before any write.
  for (const section of patch.sections) {
    try {
      ctx.fs.resolveInside(section.path); // KTD9 containment (throws PathEscapeError)
    } catch (err) {
      return { text: errMessage(err), isError: true, changed: [] };
    }
    const key = ctx.fs.canonicalPath(section.path);
    const exists = await ctx.fs.exists(section.path);
    if (!exists) {
      return {
        text:
          `Cannot edit '${section.path}': file does not exist. ` +
          `To create it, send a tagless header \`[${section.path}]\` followed by \`PUT <1:\` and the file body.`,
        isError: true,
        changed: [],
      };
    }
    if (ctx.snapshots.head(key) === null) {
      // R6/feas-03: the package would apply a live-matching tag with no prior
      // read; the adapter refuses so anchors are always read-derived.
      return {
        text: `Refusing to edit '${section.path}': no hashline read recorded this session. Read it first to get a current \`[PATH#TAG]\`.`,
        isError: true,
        changed: [],
      };
    }
  }

  try {
    const result = await ctx.patcher.apply(patch);
    const blocks = result.sections
      .map(s => {
        if (s.op === "noop") return `${s.header} (no change)`;
        // v18 file-level ops: `REM` deletes the file, `MV DEST` renames it. Neither
        // has a meaningful line-window preview (the header already names the new path).
        if (s.op === "delete") return `${s.header} (deleted)`;
        const moveBlock = s.moveDest ? ` (moved to ${s.moveDest})` : "";

        const diff = generateDiffString(s.before, s.after);
        const preview = buildCompactDiffPreview(diff);

        const warningsBlock = s.warnings.length > 0 ? `\n\nWarnings:\n${s.warnings.join("\n")}` : "";
        const previewBlock = preview.preview ? `\n${preview.preview}` : "";
        const blockBlock = s.blockResolutions && s.blockResolutions.length > 0
          ? `\n${s.blockResolutions.map(formatBlockResolution).join("\n")}`
          : "";
        // The preview only shows context around the change; if the file is larger,
        // tell the model so it re-reads before anchoring a follow-up edit far away.
        const afterLines = s.after.split("\n");
        // A trailing newline yields a final empty element that is never a preview
        // row; drop it so a fully-shown file doesn't spuriously trip the hint.
        const totalLines = afterLines[afterLines.length - 1] === "" ? afterLines.length - 1 : afterLines.length;
        const shownLines = preview.preview ? preview.preview.split("\n").filter(l => /^\d+:/.test(l)).length : 0;
        // No preview means no window to be outside of (e.g. a pure `MV`), so the
        // hint would only be noise.
        const overflowBlock =
          preview.preview && totalLines > shownLines
            ? `\n... ${totalLines} lines total; re-read with offset for regions outside this preview`
            : "";

        return `${s.header} (${s.op})${moveBlock}${blockBlock}${previewBlock}${overflowBlock}${warningsBlock}`;
      })
      .join("\n\n");
    const changed = result.sections.filter(s => s.op !== "noop").map(s => ({ before: s.before, after: s.after }));
    return { text: blocks, isError: false, changed };
  } catch (err) {
    return { text: errMessage(err), isError: true, changed: [] };
  }
}

interface CreateSection {
  path: string;
  body: string;
}

interface CreateScan {
  creates: CreateSection[];
  /** The input with create sections removed — tagged sections and their rows, in order. */
  residual: string;
  /** Rejection message for a malformed create section; when set, nothing may be applied. */
  error: string | null;
}

/**
 * A whole-file write op in a create section: v18's head/tail gap locators. For a
 * file that does not exist yet, head and tail name the same (empty) gap, so both
 * are accepted and mean "this body IS the file". Legacy `insert head:`/
 * `insert tail:` reach this via {@link normalizeHunkHeaderLine}.
 */
const CREATE_OP = /^PUT\s+(?:<1|>\$)\s*:$/;

/**
 * Split `[path]`-only create sections (no `#TAG`) out of a patch, leaving tagged
 * sections in `residual`. v18 has no native create path — a section header must
 * carry a tag and a missing file is "File not found: use the write tool" — so
 * creation stays the adapter's job (R4/KTD10).
 *
 * Strict where the input is header-shaped: inside a create section every
 * non-blank row must be a `PUT <1:` / `PUT >$:` op or a `+`-prefixed body row —
 * anything else is an error, because silently dropping it would corrupt the
 * created file. A header line (tagged or tagless) always terminates the open
 * create section, so a following tagged section can never bleed rows into the
 * create body. Op lines are read through {@link normalizeHunkHeaderLine}, so the
 * legacy spellings are accepted here exactly as they are in tagged sections.
 * Exported for direct unit testing.
 */
export function scanCreateSections(input: string): CreateScan {
  const lines = input.split("\n");
  const creates: CreateSection[] = [];
  const residual: string[] = [];
  let current: { path: string; body: string[]; sawOp: boolean } | null = null;

  const close = (): string | null => {
    if (!current) return null;
    if (!current.sawOp) {
      return (
        `Create section for '${current.path}' has no \`PUT <1:\` line. ` +
        `To create a file: a tagless \`[${current.path}]\` header, then \`PUT <1:\`, then \`+\`-prefixed body rows. ` +
        `To edit an existing file, use its tagged \`[PATH#TAG]\` header from a read.`
      );
    }
    if (current.body.length === 0) {
      return `Create section for '${current.path}' has no body rows. Add \`+TEXT\` rows after \`PUT <1:\` (a lone \`+\` is a blank line).`;
    }
    creates.push({ path: current.path, body: current.body.join("\n") });
    current = null;
    return null;
  };

  for (const line of lines) {
    const tagless = TAGLESS_CREATE_HEADER.exec(line);
    if (tagless) {
      const err = close();
      if (err) return { creates: [], residual: "", error: err };
      current = { path: tagless[1].trim(), body: [], sawOp: false };
      continue;
    }
    if (ANY_HEADER.test(line)) {
      // Tagged header: terminates any open create section and belongs to the package.
      const err = close();
      if (err) return { creates: [], residual: "", error: err };
      residual.push(line);
      continue;
    }
    if (!current) {
      residual.push(line);
      continue;
    }
    if (CREATE_OP.test(normalizeHunkHeaderLine(line))) {
      current.sawOp = true;
      continue;
    }
    if (line.startsWith("+")) {
      if (!current.sawOp) {
        return {
          creates: [],
          residual: "",
          error: `Create section for '${current.path}': body row ${JSON.stringify(line)} appears before a \`PUT <1:\` line. Put \`PUT <1:\` between the \`[${current.path}]\` header and the body rows.`,
        };
      }
      current.body.push(line.slice(1));
      continue;
    }
    if (line.trim() === "") continue; // blank separator between sections; a blank BODY line must be a lone `+`
    return {
      creates: [],
      residual: "",
      error:
        `Create section for '${current.path}': line ${JSON.stringify(line)} is not valid here. ` +
        `Every body row must start with '+' (a lone \`+\` is a blank line); nothing was applied. ` +
        `Ops other than \`PUT <1:\`/\`PUT >$:\` need an existing file — use its tagged \`[PATH#TAG]\` header.`,
    };
  }
  const err = close();
  if (err) return { creates: [], residual: "", error: err };
  return { creates, residual: residual.join("\n"), error: null };
}

function errMessage(err: unknown): string {
  if (err instanceof PathEscapeError) return err.message;
  if (isNotFound(err)) return err instanceof Error ? err.message : String(err);
  return err instanceof Error ? err.message : String(err);
}
