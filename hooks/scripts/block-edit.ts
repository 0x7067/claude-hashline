import { hashlineEnforced, readStdin, targetInProject } from "./lib-enforce.ts";

const payload = await readStdin();

if (hashlineEnforced(payload) && targetInProject(payload)) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Built-in Edit/Write/NotebookEdit are disabled by the hashline plugin. Use the hashline edit tool (mcp__plugin_claude-hashline_hashline__edit): read the file to get its [PATH#TAG], then send line-anchored ops (replace N..M:, insert after N:, delete N..M). Create a file with a tagless [path] header + insert head: body. To opt this repo out: add a .hashline-off file at the repo root, or set HASHLINE_DISABLED=1, or create ~/.hashline-off.",
      },
    }),
  );
}
