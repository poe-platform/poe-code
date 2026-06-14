# @poe-code/agent-traces

Trace discovery and normalization for local coding-agent histories.

## Sources

- `claude`: reads Claude Code JSONL sessions from `~/.claude/projects/<encoded-cwd>/*.jsonl`.
- `codex`: reads Codex thread metadata from `~/.codex/state_5.sqlite` and rollout JSONL files from the `rollout_path` column.

## API

```ts
import { collectHumanPrompts } from "@poe-code/agent-traces";

const records = await collectHumanPrompts({
  sources: ["claude", "codex"],
  cwd: process.cwd(),
  since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  limit: 200
});
```

## Options

- `sources`: Trace sources to read. Defaults to `["claude", "codex"]`.
- `cwd`: Workspace filter. Defaults to `process.cwd()`.
- `homeDir`: Home directory containing agent state. Defaults to `os.homedir()`.
- `since`: Earliest trace update or prompt timestamp to include.
- `limit`: Maximum prompt records after sorting newest first.
- `allWorkspaces`: Disable `cwd` filtering.
- `fs`: Injectable filesystem for tests and custom hosts.
- `sqlite`: Injectable SQLite factory for tests and custom hosts.

## Privacy

This package only reads local trace stores and returns normalized records. It does not send prompts to any model or write project files by itself. Use `writeHumanPromptJsonl` with an explicit path when another package needs a prompt data file.
