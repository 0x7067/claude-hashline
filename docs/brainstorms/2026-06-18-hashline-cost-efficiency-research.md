# Hashline cost-efficiency research — 2026-06-18

## Why this exists

The description-compression PR only attacks one fixed cost: the model-facing MCP
tool definitions. That is not enough, especially because haiku compliance is
sensitive to terse instructions. This note researches additional cost-efficiency
paths that should be benchmarked before changing production behavior.

## External guidance checked

- Anthropic's tool-definition docs say descriptions are the most important tool
  performance factor and should explain behavior, parameters, caveats, and when
  to use the tool. They also suggest `input_examples` for complex or
  format-sensitive inputs, while noting examples add prompt tokens.
  Source: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools>.
- Anthropic's agent-tool guidance recommends measuring tools with evaluations,
  returning only high-signal context, adding pagination/range selection/filtering
  for large responses, and making validation errors actionable.
  Source: <https://www.anthropic.com/engineering/writing-tools-for-agents>.
- Anthropic's advanced tool-use guidance points to three distinct bottlenecks:
  tool-definition bloat, intermediate-result context pollution, and parameter
  errors. It recommends tool search/deferred loading for large tool sets,
  programmatic tool calling for large intermediate results, and tool-use examples
  for malformed calls.
  Source: <https://www.anthropic.com/engineering/advanced-tool-use>.
- Anthropic prompt caching can cache static prefixes including tools and system
  instructions; cache hits are priced lower than fresh input tokens. The static
  prefix must remain byte-identical up to the cache breakpoint.
  Source: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>.

## Repository observations

- `read` already has `offset`/`limit`, but the default is 2,000 lines. That is
  friendly for success but can flood context on accidental broad reads.
- `search` already snapshots matched files and limits match count, but it returns
  one line before and three lines after each hit unconditionally.
- `edit` already returns a compact diff preview through `generateDiffString`, but
  the preview is not user-tunable and can still include unnecessary context for
  simple one-line edits.
- The SessionStart nudge repeats a mini tool manual. It improves compliance, but
  it is another fixed prompt cost and should be included in any size/performance
  accounting.
- The benchmark harness records pass rate, edit failures, output tokens, turns,
  and search calls, but it does not yet run an A/B over tool-description variants
  or nudge variants in one command.

## Candidate workstreams

| priority | idea | expected efficiency win | haiku risk | first experiment |
|---:|---|---|---|---|
| P0 | Run a real haiku A/B before merging more prompt compression. | Prevents false savings that raise retries/failures. | Low. | Add a benchmark mode that checks out/loads two description variants and runs identical fixtures with `claude-haiku-*`. |
| P0 | Measure total fixed prompt payload, including tool descriptions, JSON schemas, and SessionStart nudge. | Finds the real fixed-cost target rather than optimizing one file. | Low. | Add a script that reports chars/4 for `src/descriptions.ts`, `src/server.ts` schema descriptions, and `hooks/scripts/nudge.ts`. |
| P1 | Split examples out of prose if MCP/Claude Code supports `input_examples`. | Keeps haiku examples while letting examples become schema-validated and easier to A/B. | Medium: support through MCP/Claude Code must be verified. | Prototype `input_examples` on the `edit` tool only; compare malformed edit rate. |
| P1 | Tune `read` default output size from 2,000 lines to a smaller default plus stronger continuation hints. | Reduces accidental large read results. | Medium: too small can add extra reads. | Sweep 400/800/1200/2000 default lines on search-mode and direct-edit fixtures. |
| P1 | Add explicit `context`/`before`/`after` knobs to search. | Lets agents ask for fewer lines when anchor is obvious and more when needed. | Low if defaults stay unchanged. | Benchmark default 1-before/3-after vs 0/1 in simple locator fixtures. |
| P1 | Make edit preview context tunable or adaptive. | Reduces post-edit tool-result tokens, especially for tiny edits. | Medium: too little preview can force re-reads. | Compare fixed 2-line preview with 1-line and changed-lines-only previews. |
| P1 | Improve validation errors with a minimal corrected example for the specific failure. | May reduce retry turns after malformed patches. | Low to medium: longer error text costs tokens only on failures. | Mine transcript rejection categories and add targeted one-line repair hints. |
| P2 | Add an `edit_plan`/dry-run validator that returns a normalized patch without writing. | Could reduce failed writes for haiku on multi-hunk edits. | Medium: extra tool call may cost more than it saves. | Use only after parse failures; compare retry count. |
| P2 | Add a `replace_lines` structured helper for the most common single-range edit. | Avoids free-form patch grammar for haiku while keeping hashline anchoring. | Medium-high: more tools increase selection ambiguity. | Expose behind an experimental arm, not default; compare simple fixture pass/edit-fail. |
| P2 | Cache or persist read/search snapshots across MCP server restarts. | Avoids re-reading after session/server resets. | Medium: stale safety and filesystem correctness need care. | Prototype ledgered snapshot metadata with content-hash revalidation. |
| P2 | Use prompt caching where the hosting surface supports it. | Reduces repeated static tool/system cost without deleting guidance. | Low in API environments; uncertain in Claude Code plugin path. | Verify whether Claude Code/MCP exposes cache-control for tool definitions or system nudges. |
| P3 | Investigate tool search/deferred loading only if total tool surface grows. | Large savings for many tools, but current plugin has only three tools. | Low current ROI. | Revisit if hashline grows beyond ~10 tools or is bundled with other MCP servers. |

## Recommended next sequence

1. **Stop optimizing prose blindly.** The next PR should add measurement, not more
   compression: fixed prompt payload report plus a haiku A/B benchmark path.
2. **Benchmark output-side savings.** Tool-result payload (`read`, `search`, edit
   preview) is likely a safer target than deleting instructions, because defaults
   can be swept and rolled back based on pass rate and extra turns.
3. **Target haiku failures directly.** Use transcript mining to identify whether
   haiku loses tokens to malformed ranges, stale tags, unnecessary reads, broad
   searches, or tool-choice confusion; then optimize the dominant category.
4. **Keep examples until proven safe.** Official guidance favors detailed tool
   descriptions and examples for format-sensitive tools; hashline edit syntax is
   format-sensitive, so removing examples should require a live haiku win.

## Benchmark acceptance criteria

For any cost-efficiency change, accept only if all of the following hold on a
live `claude-haiku-*` run:

- Pass rate is no worse than baseline within the selected confidence band.
- Edit-failure/task does not increase.
- Total output tokens plus tool-result tokens decrease, or any token increase is
  offset by fewer turns.
- Search/read call counts do not rise enough to erase description/output savings.
- Results include per-fixture records so failures can be classified, not just an
  aggregate mean.
