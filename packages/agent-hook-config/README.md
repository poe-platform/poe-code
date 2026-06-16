# @poe-code/agent-hook-config

`@poe-code/agent-hook-config` is a per-run, per-spawn bridge that materializes a source agent's hooks into a target agent's hook file: it uses a symlink when source and target formats match and transforms hooks when they do not; every transformed entry carries a `statusMessage` prefix of `[generated:poe-code:<runId>] ` so cleanup can identify only what the bridge wrote.

## Supported Pairs

| Source | Target | Strategy | Notes |
|--------|--------|----------|-------|
| claude-code | codex | transform | event subset, command-only handlers, placeholder rewrite |
| claude-code | claude-code | symlink | identity (share between project and user) |

## Transform Contract: `claude-code` → `codex`

- Dropped events: `SessionEnd` and `StopFailure` because `codex` does not expose those lifecycle results; `Notification` because `codex` does not expose notification hooks; `PreCompact` and `PostCompact` because `codex` does not expose compaction hooks; `SubagentStart` and `SubagentStop` because `codex` does not expose subagent lifecycle hooks.
- Dropped handler types: `http`, `mcp_tool`, `prompt`, and `agent`; only `command` handlers are emitted.
- Placeholder rewrites: `${CLAUDE_PROJECT_DIR}` → `$(git rev-parse --show-toplevel)`, `${CLAUDE_PLUGIN_ROOT}` → `$PLUGIN_ROOT`, `${CLAUDE_PLUGIN_DATA}` → `$PLUGIN_DATA`.
- Output `statusMessage` prefix: `[generated:poe-code:<runId>] ` exactly.

## Symlink Contract

- Used only when source and target share the registry `format`.
- Replaces a stale symlink or a 100%-generated regular file.
- Refuses to clobber a user-authored file at the symlink path.

## Marker Convention

Callers and external tools identify bridge-generated entries by checking for `statusMessage` starting with the literal `[generated:`. Cleanup keys off the full `[generated:poe-code:<runId>] ` form so concurrent runs do not interfere.

## Cleanup Contract

- Idempotent.
- Removes only entries this run created.
- Removes empty event or matcher groups created by this run; preserves pre-existing empties.
- Removes the `.git/info/exclude` block by `runId` only.

## Producer Wiring

The three call sites that feed the runner's `hooks` option are `poe-code spawn --hooks-from`, pipeline `StepDefinition.hooks`, and ralph step `hooks`.

## Environment And Configuration

- Environment variables: none.
- Configuration options: none.

## Non-Goals

- No bidirectional sync.
- No conversion of opencode/goose plugin code.
- No translation of MCP-tool, HTTP, prompt, or agent handlers into command equivalents; they are dropped.
- No editing of the user's `~/.codex/hooks.json`; the bridge writes project-scope only.
