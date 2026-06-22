# Hashline token levers: cut MCP context bloat

Date: 2026-06-22

## Problem

Hashline routes all file reads/edits through its MCP server. MCP tool results
persist in context for the whole session and are not deduped/dropped the way
the harness manages built-in tool outputs. In a dev session this drove ~44% of
token usage to the `plugin:claude-hashline:hashline` server. Per-call output is
already lean (windowed read; compact diff on edit), so the fix targets *call
count and redundant re-emission*, not per-call size.

Two levers, both behavioral, made concrete here:

1. Use the built-in Read/Grep for pure exploration; reserve hashline
   `read`/`search` for the file you are about to edit (when you need the live TAG).
2. Do not re-read a file to chain edits — the returned TAG + window is enough.

## Scope

- `src/descriptions.ts` — guidance nudges (levers 1 and 2).
- `src/core.ts` `hashlineRead` — structural re-read dedup (lever 2, enforced).
- No change to `edit` or `search` behavior. No new tool args, no new flags.

## Section 1 — Description nudges

Edits to `src/descriptions.ts`:

- `READ_TOOL_DESCRIPTION`: add a line steering exploration away —
  "For browsing or understanding code you won't edit, use the built-in Read —
  its output is managed by the harness and won't pile up in context the way MCP
  results do. Reach for hashline `read` when you're about to edit a file (you
  need its live TAG)."
- `SEARCH_TOOL_DESCRIPTION`: the opener already says "prefer this … when your
  goal is to locate code and then change it" (already lever-1 aligned). Add one
  clause: "For exploration you won't act on, the built-in Grep is lighter — its
  results don't persist in context."
- `EDIT` / `READ` chain-off-the-returned-TAG guidance already exists in both;
  keep it. Lever 2's *guidance* is therefore already present.

## Section 2 — Structural re-read dedup (enforced)

In `hashlineRead`, after recording the snapshot:

```
const prev = ctx.snapshots.head(key);
const hash = ctx.snapshots.record(key, normalized);   // reuses tag if identical (read fusion)
if (prev && prev.hash === hash && !args.offset && !args.limit) {
  return `${header}\n(unchanged since last read this session; TAG ${hash} still valid — pass offset to view content)`;
}
// else: emit full body as today
```

`SnapshotStore.head(path)` returns the prior `{hash, text}`; `record()` does read
fusion (byte-identical content reuses the existing tag), so the check is free.

Trigger rule (deliberately narrow):

- Fires only on a bare re-read (no `offset`/`limit`) of a file whose content is
  byte-identical to what was already snapshotted this session — exactly the
  wasteful "re-read what I already have" case.
- Escape hatch: pass `offset` (e.g. `offset=1`) to force the full body, for when
  context was compacted and the body is genuinely needed again.
- Always emits the full body when: first read, content changed (new TAG needed),
  or an explicit range was requested.

The returned TAG is the same valid tag, so any edit anchored to it still applies.

## Non-goals

- No session cache spanning more than the last snapshot per path (the store
  already keeps it).
- No slimming of `search`/`read` per-call output (already lean).
- No `force` flag — `offset` already covers the escape hatch.

## Verification

- `bun test` — existing unit suite stays green.
- Bench suite — the dedup changes `read` output; the trigger is narrow enough
  that read-then-edit fixtures should not hit it. Run the bench and confirm no
  pass-rate regression before calling it done.
- Smallest proof for the new behavior: a unit test that reads a file twice and
  asserts the second bare read returns the TAG-only line (no body), while a
  re-read with `offset` still returns the body.
