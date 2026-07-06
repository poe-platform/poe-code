# @poe-code/agent-traces

Trace discovery and normalization for local coding-agent histories.

## Sources

- `claude`: reads Claude Code JSONL sessions from `~/.claude/projects/<encoded-cwd>/*.jsonl`.
  Top-level discovery does not recurse into per-session subdirectories. When reading a Claude
  trace, matching Task/Agent subagent transcripts from
  `~/.claude/projects/<encoded-cwd>/<session-id>/subagents/agent-<agent-id>.jsonl` are exposed as
  child trace references.
- `codex`: reads Codex thread metadata from `~/.codex/state_5.sqlite` and rollout JSONL files from the `rollout_path` column.
- `poe-code`: reads poe-code spawn log JSONL files from `~/.poe-code/spawn-logs/*.jsonl`.
  Spawn logs do not record `cwd`, so discovery includes them regardless of the workspace filter.
  Tool titles and result paths are preserved as logged, including the literal `[redacted]` value
  written by the spawn-log middleware when content logging is disabled.

## API

```ts
import { collectHumanPrompts } from "@poe-code/agent-traces";

const records = await collectHumanPrompts({
  sources: ["claude", "codex", "poe-code"],
  cwd: process.cwd(),
  since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  limit: 200
});
```

## Configuration Options

- `sources`: Trace sources to read. Defaults to all registered trace readers.
- `cwd`: Workspace filter. Defaults to `process.cwd()`.
- `homeDir`: Home directory containing agent state. Defaults to `os.homedir()`.
- `since`: Earliest trace update or prompt timestamp to include.
- `limit`: Maximum prompt records after sorting newest first.
- `allWorkspaces`: Disable `cwd` filtering.
- `fs`: Injectable filesystem for tests and custom hosts.
- `sqlite`: Injectable SQLite factory for tests and custom hosts.

The `poe-code traces` CLI maps these options to `--source`, `--all-workspaces`, `--since`, `--limit`, and `--json`. Passing a path to `poe-code traces [path]` bypasses discovery and reads that JSONL file directly through source detection.

## Normalized Traces

`NormalizedTrace` includes common session metadata, turns, and reported model usage when the
source provides it:

- `children`: Child trace references spawned by this trace. Claude populates this for Task/Agent
  tool calls when a matching `agent-<agent-id>.meta.json` sidecar points back to the tool call ID.
  Child `title` values come from the sidecar description, with `agentType` and `spawnDepth` copied
  onto the reference when present. Codex traces currently do not expose parent/child links.
- `model`: Provider-reported model name. Claude reads this from the latest assistant record with
  `message.usage`; Codex reads it from the SQLite `threads.model` column; poe-code reads it from
  the spawn log filename agent segment.
- `contextWindow`: Provider-reported model context window. This is currently populated from Codex
  `token_count` events when present.
- `usage`: Provider-reported token usage for the most recent request in the session.
  - `inputTokens`: Input tokens reported by the provider.
  - `outputTokens`: Output tokens reported by the provider.
  - `cachedTokens`: Cached input tokens when reported.
  - `cacheCreationTokens`: Cache creation input tokens when reported.
  - `contextTokens`: Current context length for the latest reported request.
  - `source`: Always `"reported"` for provider-reported usage.

For poe-code spawn logs, `contextTokens` is `inputTokens + outputTokens`. Cached tokens are already
part of input tokens and are not added again.

Malformed or missing token fields are ignored. `usage` is omitted when the trace source does not
report usage records.

Packages that display context usage should treat missing `usage` as an estimate from logged turn
text. Breakdown attribution is also estimated from logged text. Trace formats do not include the
full tool-definition schema block, and poe-code spawn logs may intentionally redact tool content,
so breakdown rows can show real tool names and call counts with near-zero measured tokens.

### Normalized Turns

Each `NormalizedTraceTurn` has a normalized `role` (`"human"`, `"assistant"`, `"tool"`, or
`"system"`) and `text`. Readers keep provider-specific format knowledge inside the reader and add
common attribution fields when the source provides enough information:

- `sourceKind`: Conventional normalized source category when known.
- `toolName`: Tool name for tool calls and tool results.
- `mcpServer`: MCP server name for MCP-backed tool calls and results.
- `skillName`: Skill name for skill instruction context.

Conventional `sourceKind` values:

- `"reasoning"`: Assistant reasoning or thinking content.
- `"tool_use"`: A tool invocation, with `toolName` and optional `mcpServer`.
- `"tool_result"`: A tool result, with inherited `toolName` and optional `mcpServer` when the
  source links results back to calls.
- `"skill_instructions"`: Skill instruction context injected by the agent runtime, with
  `skillName` when available.
- `"system_reminder"`: Runtime system reminder context.
- `"base_instructions"`: Base agent instructions or system prompt content recorded in the trace.

Other source-specific values may appear for existing normalized turns, such as Claude record types
or Codex rollout payload types.

## Privacy

This package only reads local trace stores and returns normalized records. It does not send prompts to any model or write project files by itself. Use `writeHumanPromptJsonl` with an explicit path when another package needs a prompt data file.

## Environment Variables

This package does not read public environment variables directly. Pass `cwd`, `homeDir`, filesystem, and SQLite dependencies through options.
