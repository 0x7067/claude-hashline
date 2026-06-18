/**
 * Model-facing tool descriptions. Adapted from @oh-my-pi/hashline's `prompt.md`
 * (MIT) per KTD4: the tree-sitter `block` ops are removed (out of v1 — they
 * need a native resolver, KTD1) and the "use the write tool to create files"
 * line is replaced with this adapter's tagless-create convention (KTD10).
 */

export const READ_TOOL_DESCRIPTION = `Read a text file in hashline format for editing.

Returns a header plus numbered rows:

    [src/app.ts#9A46]
    1:export function hello() {
    2:  return "world";
    3:}

Copy the latest [PATH#TAG] header into edit; TAG proves the file is unchanged.
Use bare line numbers in edit ops. After a successful edit, keep using its fresh
header/window; re-read only for unseen lines or external changes. Use offset/limit
for large files.`;

export const SEARCH_TOOL_DESCRIPTION = `Search the workspace with ripgrep and return editable hashline hits.

Use this instead of Grep when you will edit: each matched file is snapshotted and
returned as [PATH#TAG] plus rows, so visible lines can be edited without read.

    [src/app.ts#9A46]
     10:function init() {
    *11:  const ready = true;
     12:  return ready;

* marks matches; space marks context. Read the file only if you need lines outside
the shown context.

Args: pattern (Rust/RE2 regex; no backrefs/lookbehind), i, gitignore (default
true), paths, multiline, maxResults. Hidden/dot files and ignored paths are
skipped by default; truncated output says to narrow the pattern.`;

export const EDIT_TOOL_DESCRIPTION = `Apply hashline patches. Start each section with the latest [PATH#TAG] from read/search; stale tags are rejected. Use bare line numbers.

Ops:
- replace N..M: then +body rows (use replace N: for one line)
- delete N..M
- insert before N: / insert after N: then +body rows
- insert head: / insert tail: then +body rows

Ranges use two dots: replace 12..14:, not replace 12:14:. Body rows start with +;
+ alone is blank, ++text writes a literal +, +-text writes a literal -. Use one
hunk per range.

Example:

    [src/app.ts#9A46]
    replace 2:
    +  return "hashline";
    insert after 3:
    +// done

Create a file with a tagless header:

    [src/new.ts]
    insert head:
    +export const x = 1;

A successful edit returns a fresh [PATH#TAG] and result window for the next edit.
Built-in Edit/Write tools are disabled; use this tool for all text edits.`;
