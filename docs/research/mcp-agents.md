# MCP Agent Config Locations (Unsupported)

This project can automatically configure MCP servers for a small set of supported agents.
For other MCP-capable clients, config locations and keys are easy to lose track of and can go stale in code.

This document is a single place to capture known MCP config locations for **unsupported** agents/clients as a user-facing reference.
Nothing in runtime code reads this list.

## Registry

| Agent ID | Config file | Config key | Format | Notes |
| --- | --- | --- | --- | --- |
| `cursor` | `~/.cursor/mcp.json` | `mcpServers` | `json` |  |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | `json` |  |
| `vscode` | `~/.vscode/settings.json` | `mcp.servers` | `json` | Nested under `mcp.servers`. |
| `cline` | `~/.cline/mcp_settings.json` | `mcpServers` | `json` |  |
| `roo-cline` | `~/.roo-cline/mcp_settings.json` | `mcpServers` | `json` |  |
| `zed` | `~/.config/zed/settings.json` | `context_servers` | `json` | Uses `context_servers` instead of `mcpServers`. |
| `goose` | `~/.config/goose/config.yaml` | `extensions` | `yaml` | Uses YAML format. |
| `aider` | `~/.aider.conf.yml` | `mcp-servers` | `yaml` | Uses YAML format. |
| `aider-desk` | `~/.aider-desk/mcp.json` | `mcpServers` | `json` |  |
| `gemini-cli` | `~/.gemini/settings.json` | `mcpServers` | `json` |  |
| `witsy` | `~/.witsy/mcp.json` | `mcpServers` | `json` |  |
| `enconvo` | `~/.enconvo/mcp.json` | `mcpServers` | `json` |  |
| `droid` | `~/.droid/mcp.json` | `mcpServers` | `json` |  |

