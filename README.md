# claude-hashline

A Claude Code plugin.

> TODO: Describe what this plugin does and why someone would install it.

## Structure

```
claude-hashline/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest (required)
├── commands/                # Slash commands (.md)
├── agents/                  # Subagent definitions (.md)
├── skills/                  # Auto-activating skills (<name>/SKILL.md)
├── hooks/
│   ├── hooks.json           # Event handler configuration
│   └── scripts/             # Hook scripts
├── .mcp.json                # MCP server definitions
└── scripts/                 # Shared helper scripts
```

Each component directory currently holds a placeholder example — rename or
replace them with real components. Auto-discovery picks up any `.md` files in
`commands/` and `agents/`, and any `SKILL.md` under `skills/*/`.

## Development

Reference intra-plugin paths with `${CLAUDE_PLUGIN_ROOT}` — never hardcode
absolute paths.

To try it locally, add this directory as a local plugin in Claude Code.
