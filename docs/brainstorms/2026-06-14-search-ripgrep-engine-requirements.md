---
title: "Search engine: adopt ripgrep for the hashline search tool"
date: 2026-06-14
status: ready-for-planning
type: requirements
---

# Search engine: adopt ripgrep for the hashline `search` tool

## Problem Frame

The `search` tool hand-rolls a recursive file walker and matches each line with JavaScript `new RegExp(pattern)` (`src/core.ts`, `hashlineSearch`). Three gaps trace to that choice:

- **ReDoS exposure** — a model-supplied pattern runs per-line across every file with no backtracking budget; a catastrophic pattern can hang the whole MCP call. The pattern comes from the model, not an external attacker, so this is self-DoS within the user's own session — a robustness problem, not a security-boundary breach.
- **Shallow gitignore** — only the repo-root `.gitignore` is honored; nested `.gitignore` files are ignored.
- **Missing parity** — no `paths` scoping, no multiline matching, and slower than a real engine on large trees.

The published `@oh-my-pi/hashline` package ships no search module — our search was always a behavioral reimplementation of the oh-my-pi *harness*, which itself shells out to ripgrep. Adopting ripgrep is both the faithful "match oh-my-pi" move and the single change that closes all three gaps at once.

---

## Requirements

- **R1.** Replace the file-walk + JS-`RegExp` scan with ripgrep (`@vscode/ripgrep`), spawned as a subprocess consuming `--json` output.
- **R2.** Preserve the output contract verbatim: per-file `[PATH#TAG]` header, `*N:text` match rows, ` N:text` context rows, the 1-before/3-after window, and 512-column truncation with a trailing `…`.
- **R3.** Preserve match-gated whole-file snapshot recording: each matched file is full-read to record its snapshot and compute its TAG, so the model can `edit` straight off a hit with no prior `read`. Unmatched files are never read or recorded.
- **R4.** Map existing args to ripgrep flags: `i` → `-i`; `gitignore:false` → `--no-ignore` (default-on respects nested `.gitignore`); `maxResults` → a total match-count cap.
- **R5.** Add a `paths` arg scoping the search to one or more workspace-relative subpaths (passed as positional args to rg), each validated against the workspace jail.
- **R6.** Add a `multiline` boolean arg (ripgrep `-U`).
- **R7.** When ripgrep cannot be spawned, fail with a clear, actionable error message. There is no fallback search path.
- **R8.** All search targets stay inside the workspace jail: `paths` args are canonicalized and contained, and ripgrep is not permitted to follow symlinks out of the workspace.

---

## Key Decisions

- **Engine: `@vscode/ripgrep` (bundled binary).** v1.18.0 ships prebuilt per-platform binaries as optional dependencies — no postinstall network download, deterministic offline install. Exposes `rgPath`; we spawn it under Bun. A linear-time RE2 engine eliminates the ReDoS class for free.
- **Consume `--json`, not text.** ripgrep's JSON message stream (begin / match / context / end / summary) maps 1:1 onto our block model and is the format ripgrep itself recommends for tool integration. Verified live: `begin.data.path.text`, `match.data.line_number` + `lines.text` + `submatches[]`, `context.data.line_number` + `lines.text`.
- **Delete `mergeWindows`.** `rg -B1 -A3` produces the exact 1-before/3-after window and merges overlapping windows natively, so the hand-rolled window-merge logic is removed, not ported.
- **Regex dialect changes JS → Rust/RE2.** No backreferences or lookbehind. For code search this is an upgrade (predictable, linear-time); benchmark anchors are plain identifiers, so the suite is unaffected. The dialect must be documented in the tool description.
- **Remove the JS walker entirely.** Bundled binaries cover all mainstream platforms; carrying a second search implementation as a fallback is dead-weight. Spawn failure is a hard error (R7).

---

## Scope Boundaries

- **In scope:** the engine swap; `paths` + `multiline` args; nested-`.gitignore` (free); ReDoS elimination (free); tool-description update for the dialect; re-benchmark for no-regression.
- **Deferred to follow-up:** column-accurate match highlighting using `submatches[]` offsets; exposing further ripgrep flags (file-type filters, `--hidden`, glob includes/excludes).
- **Non-goals:** changing the edit / read / snapshot core; changing the output format; the per-line-hash harness variant.

---

## Dependencies / Assumptions

- New runtime dependency `@vscode/ripgrep`. This relaxes the standing "prefer existing deps" rule — explicitly authorized by the user for this and future work.
- Bun can spawn the bundled `rg` binary (`Bun.spawn` or `node:child_process`).
- The MCP server's workspace-jail root is the search root passed to ripgrep.

---

## Success Criteria

- Search returns the same output format as today for the same query on the same corpus (modulo dialect-incompatible patterns).
- The search-mode benchmark shows no pass-rate regression and search is still exercised (`search/task` > 0 for the hashline arm).
- A known catastrophic-backtracking pattern that would hang the JS implementation completes promptly under ripgrep.
- Nested `.gitignore`, `paths` scoping, and `multiline` each work as specified.
- Spawn failure produces a clear error, not a hang or a silent empty result.

---

## Outstanding Questions (deferred to planning)

- Total-match-cap mechanism: count consumed JSON `match` messages vs. ripgrep `-m` per-file (HOW detail).
- Whether to keep our own 512-column truncation in the formatter or use ripgrep `--max-columns` / `--max-columns-preview`.
