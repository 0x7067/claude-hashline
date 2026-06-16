# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Edit format

### Hashline
The line-anchored patch format this project provides as an MCP edit tool: a per-file header followed by numbered text rows, where edits cite bare line numbers taken from a prior read of the same file rather than matching on surrounding text.

A read returns a header carrying the file's path and a TAG, then one row per line prefixed with its line number and a colon. To edit, the caller copies the header verbatim and references those line numbers in Hunks. A file must be read before it can be edited, and re-read after each edit to obtain a fresh TAG.

### TAG
The short content hash of an entire file — the hash of its current Snapshot — carried in a read/search/edit header to prove the file is unchanged since it was read. An edit whose TAG no longer matches the file's current contents is rejected, forcing a re-read — this is the optimistic-concurrency guard against editing a stale view.

### Snapshot
The recorded whole-file content, keyed by canonical absolute path, from which a TAG is minted. A tool that records one is a *snapshot producer*: `read`, `search`, and `write` all record a snapshot for the files they touch. The read-before-edit gate refuses to edit any file with no snapshot recorded this session, so every edit anchors on content a producer actually returned — which is why `search` can edit a matched file with no prior `read`.

### Hunk
A single edit operation (replace, delete, or insert) introduced by a header that names its target line(s); the text rows that follow apply to that operation. A body row with no preceding Hunk header is rejected — the error that the colon-range mistake (see Line range) produces.

### Line range
The span an edit operation targets, written with two dots: `N..M` for a span, `N:` for a single line. A colon between two numbers (`N:M:`) is invalid syntax — the trailing colon in a read row labels that line, it is not range punctuation.

## Containment

### Workspace jail
The path-containment gate that confines every edit to the workspace root, rejecting any target path that resolves outside it.
*Avoid:* JailedFilesystem.

Containment is decided on canonical (symlink-resolved) paths for both the root and the target, so a non-canonical root or a symlink inside the workspace cannot produce a false escape or a real one. Soundness depends on canonicalizing both sides; comparing merely-absolutized paths is a latent traversal bug.

## Validation harness

### Optimize loop
The closed feedback process that hill-climbs the edit harness against the benchmark: it re-measures a fixed baseline and a candidate change back-to-back, compares them paired per fixture, and keeps the candidate only if it improves the objective without regressing pass rate beyond noise.

### Edit-fail
A benchmark outcome where the model's patch is rejected for malformed edit syntax, as distinct from a task-correctness miss where a syntactically valid edit produces the wrong result. Edit-fails are the harness-addressable failure class; correctness misses are not.

## Token accounting

### Savings ledger
The per-project, append-only record of output tokens each hashline edit saved versus the editor it replaced. One JSONL row per successful edit, summed by the `/hashline-savings` rollup. Tracks wins only — failed edits are not recorded — and counts are chars/4 estimates, directional rather than billable.

### Counterfactual baseline
The alternative edit the saving is measured against. The honest baseline is `str_replace` (the old text plus the new text the model would otherwise have typed), so a saving is "the old text you didn't reproduce" — not a full-file `Write` of the whole post-edit file, which overstates the saving by roughly the file size and is the strawman the metric must avoid.
