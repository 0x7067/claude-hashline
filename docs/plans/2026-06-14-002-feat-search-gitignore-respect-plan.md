---
title: "feat: gitignore-respect for hashline search (oh-my-pi parity)"
date: 2026-06-14
type: feat
origin: docs/plans/2026-06-14-001-feat-hashline-tagged-search-plan.md
depth: standard
---

# feat: gitignore-respect for hashline search (oh-my-pi parity)

## Summary

oh-my-pi's `search` tool takes a `gitignore` boolean (default `true`) and skips
ignored paths during directory scans. Our `hashlineSearch` walks everything
except `node_modules`/dot-dirs. This adds gitignore-respect to close that parity
gap: filter walked files through the repo's `.gitignore` using the standard
`ignore` package, default-on, with an opt-out.

This is the next increment after the search tool (origin) and the oh-my-pi
output-format alignment already landed on `feat/hashline-tagged-search`.

---

## Problem Frame

`hashlineSearch` (`src/core.ts`) emits matches from gitignored files — build
output, logs, generated artifacts. This repo's own `.gitignore` excludes
`report*.md` and `report.err`, yet a search would surface them. oh-my-pi avoids
this by passing `gitignore: true` to its native grep. We have no equivalent.

---

## Key Technical Decisions

1. **Use the `ignore` package, not a hand-rolled matcher.** gitignore semantics
   (negation, `**`, anchored vs. unanchored, dir-only trailing slash) are subtle;
   matching oh-my-pi means correct semantics. `ignore@7` is zero-dependency and
   implements the spec. Added to `dependencies`.
2. **Root `.gitignore` only for v1.** Load `${root}/.gitignore` into one matcher.
   Nested per-directory `.gitignore` files (which ripgrep/oh-my-pi also honor) are
   a deferred refinement — the root file covers the dominant cases. The hard
   `node_modules`/`.git` skip-set stays as a floor regardless of gitignore state.
3. **Default-on, opt-out via `gitignore: false`.** Mirrors oh-my-pi's default.
4. **Filter at file level, not dir-pruning.** Apply `ig.ignores(relPath)` to each
   walked file rather than pruning directories mid-walk — simpler and correct;
   the hard skip-set already prevents descending into the expensive dirs.

---

## Implementation Units

### U1. gitignore filtering in `hashlineSearch`

**Goal:** Skip gitignored files in search results, default-on.

**Requirements:** oh-my-pi `gitignore` parity.

**Files:**
- `src/core.ts` — add `gitignore?: boolean` to `SearchArgs`; build an `ignore`
  matcher from `${ctx.root}/.gitignore` when not disabled; filter walked files.
- `test/core.test.ts` — add scenarios.

**Approach:**
- `import ignore from "ignore"`.
- Helper `loadGitignore(root): { ignores(rel: string): boolean } | null` — read
  `${root}/.gitignore` if present, return `ignore().add(text)`; null when the
  file is absent or reading fails.
- In `hashlineSearch`, when `args.gitignore !== false`, build the matcher once and
  `continue` on any walked file whose root-relative POSIX path it ignores.
- Normalize the relative path to forward slashes (the `ignore` package requires
  POSIX separators) before testing.

**Patterns to follow:** existing walk + per-file loop in `hashlineSearch`.

**Test scenarios:**
- A file matched by a root `.gitignore` pattern (e.g. `ignored.log` under
  `*.log`) is absent from results when `gitignore` defaults on. *(happy path)*
- The same file IS returned when `gitignore: false`. *(opt-out)*
- With no `.gitignore` present, search behaves exactly as before. *(no-regression)*
- A non-ignored sibling still matches in the same run. *(scoping sanity)*

**Verification:** `bun test` green; a search in this repo no longer returns
`report.md`.

---

### U2. Wire `gitignore` through the MCP tool

**Goal:** Expose the flag and document it.

**Requirements:** oh-my-pi `gitignore` parity (surface).

**Dependencies:** U1.

**Files:**
- `src/server.ts` — add `gitignore: z.boolean().optional()` to the `search` schema;
  pass through.
- `src/descriptions.ts` — one line in `SEARCH_TOOL_DESCRIPTION`: respects
  `.gitignore` by default; pass `gitignore:false` to include ignored files.

**Test scenarios:** `Test expectation: none -- thin MCP wiring over U1.`

**Verification:** `tsc --noEmit` clean.

---

## Scope Boundaries

**In scope:** root `.gitignore` respect, default-on, opt-out flag, tests.

### Deferred to Follow-Up Work (remaining oh-my-pi parity)
- **Nested `.gitignore`** files and `.git/info/exclude`.
- **`paths` scoping** — search within a file/dir/glob/line-range (oh-my-pi's
  `paths` arg). Non-trivial path resolution; deferred to keep this increment safe.
- **Multiline matching** — oh-my-pi enables multiline when the pattern contains a
  newline; our matcher is per-line, so this needs a match-loop restructure.
- **File-page pagination (`skip`)**, archive-member and internal-URL search,
  brace-union globs, BM25/ast-grep — full-harness features, out of scope for this
  plugin.

---

## Validation / Benchmark

After merge, run a fresh benchmark (`bench/run.ts`, 12 fixtures, haiku + sonnet,
hashline vs control arms) to confirm adding `search` + gitignore did not regress
the hashline edit path. Note: the benchmark tasks are single-file fixes, so they
exercise `read`/`edit`, not `search` — this run is a regression check and a fresh
baseline, not a test of search itself.
