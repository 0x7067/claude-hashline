/**
 * Hashline MCP server. Exposes `read` and `edit` over stdio so Claude Code
 * routes editing through the line-anchored hashline patch language while the
 * PreToolUse hook blocks the built-in editors. Run under Bun: `bun run
 * src/server.ts`. The namespace Claude sees is
 * `mcp__plugin_claude-hashline_hashline__{read,edit}`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createContext, hashlineEdit, hashlineRead, hashlineSearch } from "./core.ts";
import { EDIT_TOOL_DESCRIPTION, READ_TOOL_DESCRIPTION, SEARCH_TOOL_DESCRIPTION } from "./descriptions.ts";

const ctx = createContext();

const server = new McpServer({ name: "hashline", version: "0.1.0" });

server.registerTool(
  "read",
  {
    description: READ_TOOL_DESCRIPTION,
    inputSchema: {
      path: z.string().describe("Workspace-relative or absolute path to read."),
      offset: z.number().int().positive().optional().describe("1-indexed start line."),
      limit: z.number().int().positive().optional().describe("Max lines to return from offset."),
    },
  },
  async ({ path, offset, limit }) => {
    try {
      const text = await hashlineRead(ctx, { path, offset, limit });
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  },
);

server.registerTool(
  "search",
  {
    description: SEARCH_TOOL_DESCRIPTION,
    inputSchema: {
      pattern: z.string().describe("Regex source matched against each line."),
      i: z.boolean().optional().describe("Case-insensitive search."),
      gitignore: z.boolean().optional().describe("Respect .gitignore (default true); set false to include ignored files."),
      maxResults: z.number().int().positive().optional().describe("Cap on total match lines returned."),
    },
  },
  async ({ pattern, i, gitignore, maxResults }) => {
    try {
      const text = await hashlineSearch(ctx, { pattern, i, gitignore, maxResults });
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  },
);

server.registerTool(
  "edit",
  {
    description: EDIT_TOOL_DESCRIPTION,
    inputSchema: {
      input: z.string().describe("One or more hashline file sections. See the tool description for the grammar."),
    },
  },
  async ({ input }) => {
    const result = await hashlineEdit(ctx, input);
    return { content: [{ type: "text", text: result.text }], isError: result.isError };
  },
);

await server.connect(new StdioServerTransport());
