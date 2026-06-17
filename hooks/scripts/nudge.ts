import { hashlineEnforced, readStdin } from "./lib-enforce.ts";

const payload = await readStdin();

if (hashlineEnforced(payload)) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "This workspace enforces hashline editing: the built-in Edit, Write, and NotebookEdit tools are BLOCKED here. Use the hashline edit tool (mcp__plugin_claude-hashline_hashline__edit) for every file change: read a file to get its [PATH#TAG], then send line-anchored ops (replace N..M:, insert after N:, delete N..M); create a file with a tagless [path] header + insert head: body. When searching for code you intend to change, use the hashline search tool (mcp__plugin_claude-hashline_hashline__search) instead of Grep; it returns the same [PATH#TAG] format so you can edit straight off a hit, no read first. Built-in Read and Grep stay available for plain exploration. To opt this repo out, add a .hashline-off file at the repo root.",
      },
    }),
  );
}
