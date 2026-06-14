---
title: "Path-containment jail must canonicalize root and target via realpath, not path.resolve"
date: 2026-06-13
category: docs/solutions/security-issues
module: hashline jailed filesystem
problem_type: security_issue
component: tooling
symptoms:
  - "Valid in-workspace files rejected with PathEscapeError (\"outside the workspace\")"
  - "Spurious rejections only on macOS, where /var is a symlink to /private/var"
  - "A symlink created inside the workspace pointing outside it slips past the containment check"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - hashline edit tool
  - benchmark harness
tags:
  - path-containment
  - symlink
  - realpath
  - jailed-filesystem
  - macos
  - directory-traversal
---

# Path-containment jail must canonicalize root and target via realpath, not path.resolve

## Problem
The `JailedFilesystem` containment gate (KTD9 / SEC-002) stored its workspace root with `path.resolve`, which normalizes `.`/`..` and makes a path absolute but does **not** resolve symlinks. On any host where the workspace lives under a symlinked path — most commonly macOS, where `/var` is a symlink to `/private/var` and `$TMPDIR` resolves under it — the stored root stayed in its non-canonical form while the model supplied canonical absolute paths. The `startsWith(root)` prefix check then rejected valid in-workspace files as escapes. The same gap had a security face: a symlink created *inside* the workspace and pointing *outside* it resolved to its real (external) target only if you canonicalized — without canonicalization it slipped through the gate.

## Symptoms
- Valid in-workspace files rejected with `PathEscapeError` ("outside the workspace").
- Reproducible on macOS (`/var` → `/private/var`); invisible on Linux hosts without a symlinked root.
- In the first benchmark sweep this inflated the hashline arm's edit-failure / token / turn metrics — roughly **11 of 30 rejections were spurious**, contaminating efficiency numbers and forcing a re-run. (session history)
- A symlink inside the workspace pointing out would not be caught by the prefix check.

## What Didn't Work
- **`path.resolve(root)` for the root.** It is the obvious "make this absolute and normalized" call, but it deliberately preserves symlinks. The root and the (canonical) target then live in two different namespaces, so a pure string prefix comparison is comparing apples to oranges.
- **Canonicalizing only one side.** Resolving just the target (or just the root) does not help — both the root and the candidate path must be in the same canonical namespace for `startsWith` to mean "contained in".
- **Plain `realpathSync(target)` on the resolved target.** The target may be a file that does not exist yet (the whole point of an edit/create tool), and `realpath` throws `ENOENT` on a non-existent path. A naive realpath of the target breaks file creation.

## Solution
Canonicalize **both** the root (once, in the constructor) and every resolved target through a helper that resolves the longest existing ancestor and re-appends the not-yet-created tail segments:

```ts
import { realpathSync } from "node:fs";
import * as path from "node:path";

function canonicalize(abs: string): string {
  const segs: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return segs.length ? path.join(real, ...segs.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs; // reached fs root; nothing to resolve
      segs.push(path.basename(cur));
      cur = parent;
    }
  }
}

// constructor
this.root = canonicalize(path.resolve(root));

// resolveInside(p)
const resolved = canonicalize(path.resolve(this.root, p));
if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
  throw new PathEscapeError(p, resolved, this.root);
}
```

The `path.resolve` step still runs first (to absolutize and collapse `..`); `canonicalize` then resolves symlinks on the deepest existing portion of the path. A regression test covering the symlinked-root and inside-out-symlink cases was added in the same change.

## Why This Works
`path.resolve` and `realpath` answer different questions: `resolve` is pure lexical normalization; `realpath` performs filesystem resolution of every symlink in the path. Containment is a property of the **real** filesystem, so the check is only sound when both operands are real paths. Canonicalizing the longest existing ancestor (rather than the full target) keeps creation of new files working, because the parent directory exists even when the leaf does not — and a symlink can only exist where a filesystem node already exists, so resolving the existing prefix is sufficient to defeat symlink escapes.

## Prevention
- **Any path-containment / sandbox / jail check must compare canonical (realpath'd) paths on both sides.** A `startsWith(root)` test over `path.resolve` output is a latent traversal bug, not a containment guarantee.
- **Test on a symlinked root.** macOS `$TMPDIR` (under `/var` → `/private/var`) is a free, always-available reproduction; a containment test suite that only runs on Linux CI will pass while the gate is broken. Add a fixture that creates the workspace under a symlinked directory.
- **Test the inside-out symlink escape explicitly** — create a symlink inside the workspace pointing to an external file and assert it is rejected. The benign-rejection bug and the malicious-escape bug share the same root cause; one regression test family covers both.
- **Handle the not-yet-created target** in the canonicalizer (resolve the existing ancestor) so hardening the check does not break file creation.

## Related Issues
- Discovered during the hashline benchmark harness work; the spurious-rejection contamination is recorded in `docs/benchmark/2026-06-14-overnight-loop.md`.
- Commit `c856504` — fix(jail): canonicalize root and target via realpath (symlink containment).
