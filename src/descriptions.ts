/**
 * Model-facing tool descriptions. Adapted from @oh-my-pi/hashline's `prompt.md`
 * (MIT) per KTD4: the tree-sitter `block` ops are removed (out of v1 — they
 * need a native resolver, KTD1) and the "use the write tool to create files"
 * line is replaced with this adapter's tagless-create convention (KTD10).
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
window or after an external change. Use \`offset\`/\`limit\` for large files.`;

export const SEARCH_TOOL_DESCRIPTION = `Search the workspace for a regex pattern and return matches ready to edit.

Prefer this over the built-in Grep when your goal is to locate code and then
change it: matches come back in the SAME hashline format as \`read\` — a
\`[PATH#TAG]\` header per file followed by \`LINE:TEXT\` rows — and each matched
file is snapshotted, so you can \`edit\` straight off a hit WITHOUT a separate
\`read\` first.

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

Operations:
- \`replace N..M:\` — replace lines N..M with the body rows below (\`replace N:\` for one line).
- \`delete N..M\` — delete lines N..M (no body).
- \`insert before N:\` / \`insert after N:\` — insert body rows before/after line N.
- \`insert head:\` / \`insert tail:\` — insert body rows at the start/end of the file.

Line ranges use TWO DOTS, never a colon between the numbers. Write \`replace 12..14:\`
for a span and \`replace 23:\` for a single line. A colon range like \`replace 23:23:\`
or \`replace 12:14:\` is INVALID and will be rejected — the \`N:\` in a \`read\` row
(\`23:export …\`) labels the line, it is not range syntax.

Body rows are \`+TEXT\`; \`+\` alone is a blank line. To write a literal line starting
with \`+\` or \`-\`, prefix it (\`++text\`, \`+-text\`). Issue one hunk per range.

Example — replace line 2 and insert after line 3:

    [src/app.ts#9A46]
    replace 2..2:
    +  return "hashline";
    insert after 3:
    +// done

Create a new file with a TAGLESS header and an \`insert head:\` body:

    [src/new.ts]
    insert head:
    +export const x = 1;

A successful edit returns the new \`[PATH#TAG]\` and a numbered window around the
change — anchor your next edit to that tag and those line numbers directly,
without re-reading the file.

You must \`read\` a file before your first edit. The built-in Edit/Write tools are
disabled — use this tool for all text edits.`;
