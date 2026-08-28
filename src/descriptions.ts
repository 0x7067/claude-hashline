/**
 * Model-facing tool descriptions. Adapted from @oh-my-pi/hashline's `prompt.md`
 * (MIT) per KTD4 — v18's `PUT`/`CUT` grammar as of the 15.12.4 → 18.0.9
 * migration. Three deviations from upstream's prompt:
 *  - the tree-sitter block locators (`PUT N*:`, `PUT >N*:`, `CUT N*`) are
 *    removed: no resolver is wired (KTD1), so the engine rejects them;
 *  - the register/clipboard ops (`CUT … @name` + `PUT … @name`) are removed —
 *    they work, but they are a second grammar to learn for a move this adapter's
 *    callers do with a plain cut+put; and the file-level `REM`/`MV` ops are left
 *    undocumented (they apply, jailed, if a model emits them anyway);
 *  - "use the `write` tool to create new files" is replaced with this adapter's
 *    tagless-create convention (KTD10) — there is no `write` tool here.
 */

export const READ_TOOL_DESCRIPTION = `Read a text file and return it in hashline format for editing.

Output is a header line \`[PATH#TAG]\` followed by \`LINE:TEXT\` rows, e.g.:

    [src/app.ts#9A46]
    1:export function hello() {
    2:  return "world";
    3:}

TAG is a 4-hex content hash of the whole file. To edit, copy the header verbatim
into the \`edit\` tool and reference the bare line numbers. A successful \`edit\`
returns the fresh \`[PATH#TAG]\` and a numbered window of the result, so you can
make the next edit without re-reading; re-read only for lines outside that
window or after an external change. Use \`offset\`/\`limit\` for large files.

For browsing or understanding code you won't edit, use the built-in Read instead
— its output is managed by the harness and won't pile up in context the way MCP
results do. Reach for hashline \`read\` when you're about to edit a file (you need
its live TAG).`;

export const SEARCH_TOOL_DESCRIPTION = `Search the workspace for a regex pattern and return matches ready to edit.

Prefer this over the built-in Grep when your goal is to locate code and then
change it: matches come back in the SAME hashline format as \`read\` — a
\`[PATH#TAG]\` header per file followed by \`LINE:TEXT\` rows — and each matched
file is snapshotted, so you can \`edit\` straight off a hit WITHOUT a separate
\`read\` first. For exploration you won't act on, the built-in Grep is lighter —
its results don't persist in context.

    [src/app.ts#9A46]
     10:function init() {
    *11:  const ready = true;
     12:  return ready;

Match lines are prefixed \`*\`; surrounding context lines a single space (one line
before, three after each hit). To change a line you can see, copy that file's
\`[PATH#TAG]\` header into \`edit\` and reference the line number. If you need lines
OUTSIDE the shown context, \`read\` that file for
the full tagged view.

Powered by ripgrep. \`pattern\` is Rust/RE2 regex syntax — fast and linear-time,
so it never hangs, but there are NO backreferences or lookbehind. Args:
\`pattern\` (required), \`i\` (case-insensitive), \`gitignore\` (respect .gitignore /
.ignore, default true; pass false to include ignored files), \`paths\` (array of
workspace-relative subpaths to scope the search; defaults to the whole tree),
\`multiline\` (let a single pattern span lines), \`maxResults\` (cap on returned
matches; results truncate with a hint to narrow the pattern).
Hidden/dot files and ignored paths are skipped by default.`;

export const EDIT_TOOL_DESCRIPTION = `Apply line-anchored edits to a file using the hashline patch language.

Each section starts with the \`[PATH#TAG]\` header from your latest \`read\` of that
file (the TAG proves the file is unchanged; a stale TAG is rejected). Reference
bare line numbers from that read.

Operations. A header ending in \`:\` takes \`+\` body rows below it; \`CUT\` takes none.
- \`PUT N.=M:\` — replace original lines N through M (INCLUSIVE) with the body rows.
- \`CUT N.=M\` — delete original lines N through M. No body.
- \`PUT <N:\` — insert the body rows BEFORE line N (\`PUT <1:\` = start of file).
- \`PUT >N:\` — insert the body rows AFTER line N (\`PUT >$:\` = end of file).
- Single line: \`PUT 7.=7:\` / \`CUT 7.=7\`.

The range is the ORIGINAL lines you consume; body length is irrelevant (replacing
1 line with 10 is still \`PUT N.=N:\`). Numbers refer to the file as you read it and
do NOT shift as earlier hunks in the same call apply.

Range endpoints are joined by \`.=\` — \`PUT 12.=14:\`, never a colon between the two
numbers. The \`N:\` in a \`read\` row (\`23:export …\`) labels that line; it is not range
syntax, so \`PUT 12:14:\` is wrong (this tool repairs it, but write \`.=\`).

Body rows are \`+TEXT\`, inserted verbatim with their leading whitespace; \`+\` alone
is a blank line. There is NO other row kind — never write \`-old\` or a bare context
line. The range does the deleting; the body is the FINAL content. To keep a line,
leave it out of every range. For a literal line starting with \`+\` or \`-\`, prefix it
(\`++text\`, \`+- item\` for a Markdown bullet). One hunk per range.

Example — replace line 2 and add a line after line 3:

    [src/app.ts#9A46]
    PUT 2.=2:
    +  return "hashline";
    PUT >3:
    +// done

Create a new file with a TAGLESS header (no \`#TAG\`) and a \`PUT <1:\` body:

    [src/new.ts]
    PUT <1:
    +export const x = 1;

EVERY body row of a create must start with \`+\` — a row without it is rejected
(never silently dropped). Tagged edit sections and tagless create sections can
be mixed in one call; if any section is rejected, nothing is applied.

Ranges stay TIGHT: cover only the lines whose content changes, never widen over
lines you are keeping (a widened \`PUT\` drops the keepers you retype). A pure
addition is \`PUT <N:\`/\`PUT >N:\`, never a widened \`PUT N.=M:\`. Non-adjacent changes
are separate hunks. Never start or end a range mid-expression, and never anchor a
hunk into a region you have not seen as \`LINE:TEXT\` rows — re-\`read\` it first.

A successful edit returns the new \`[PATH#TAG]\` and a numbered window around the
change — anchor your next edit to that tag and those line numbers directly,
without re-reading the file. On a stale-tag rejection or any surprising result,
STOP and re-\`read\` before editing again.

You must \`read\` a file before your first edit. The built-in Edit/Write tools are
disabled — use this tool for all text edits.`;
