/**
 * Model-facing tool descriptions. Adapted from @oh-my-pi/hashline's `prompt.md`
 * (MIT) per KTD4: the tree-sitter `block` ops are removed (out of v1 — they
 * need a native resolver, KTD1) and the "use the write tool to create files"
 * line is replaced with this adapter's tagless-create convention (KTD10).
 */

export const READ_TOOL_DESCRIPTION = `Read a text file in hashline format for editing.

Output is a [PATH#TAG] header followed by LINE:TEXT rows:

    [src/app.ts#9A46]
    1:export function hello() {
    2:  return "world";
    3:}

Copy the latest [PATH#TAG] header verbatim into edit and reference bare line
numbers. TAG proves the file is unchanged; stale tags are rejected. A successful
edit returns a fresh [PATH#TAG] plus a numbered result window, so keep editing
from that window without re-reading. Re-read only for lines outside the window or
after external changes. Use offset/limit for large files.`;

export const SEARCH_TOOL_DESCRIPTION = `Search the workspace with ripgrep and return editable hashline hits.

Use this instead of Grep when you will edit: every matched file is snapshotted and
returned as a [PATH#TAG] header plus LINE:TEXT rows, so you can edit visible lines
without a separate read.

    [src/app.ts#9A46]
     10:function init() {
    *11:  const ready = true;
     12:  return ready;

* marks a match; a leading space marks context. To change a visible line, copy
that file's [PATH#TAG] header into edit and use the shown line number. Read the
file only if you need lines outside the shown context.

Args: pattern (required Rust/RE2 regex; no backrefs/lookbehind), i
(case-insensitive), gitignore (default true), paths, multiline, maxResults.
Hidden/dot files and ignored paths are skipped by default; truncated output says
to narrow the pattern.`;

export const EDIT_TOOL_DESCRIPTION = `Apply hashline patches. Start each section with the latest [PATH#TAG] from read/search; stale tags are rejected. Use bare line numbers.

Ops:
- replace N..M: then +body rows (replace N: for one line)
- delete N..M (no body)
- insert before N: / insert after N: then +body rows
- insert head: / insert tail: then +body rows

Ranges use two dots, never a colon between numbers: replace 12..14:, not replace
12:14:. Body rows start with +; + alone is blank. To write a literal line starting
with + or -, prefix it as ++text or +-text. Use one hunk per range.

Example:

    [src/app.ts#9A46]
    replace 2:
    +  return "hashline";
    insert after 3:
    +// done

Create a new file with a tagless header and insert head:

    [src/new.ts]
    insert head:
    +export const x = 1;

A successful edit returns a fresh [PATH#TAG] and numbered window for the next
edit. You must read or search a file before your first edit. Built-in Edit/Write tools are disabled; use this tool for all text edits.`;
