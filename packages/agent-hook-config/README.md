# @poe-code/agent-hook-config

`@poe-code/agent-hook-config` is a per-run, per-spawn bridge that materializes a source agent's hooks into a target agent's hook file: it uses a symlink when source and target formats match and transforms hooks when they do not; every transformed entry carries a `statusMessage` prefix of `[generated:poe-code:<runId>] ` so cleanup can identify only what the bridge wrote.

## Supported Pairs

| Source      | Target      | Strategy  | Notes                                                    |
| ----------- | ----------- | --------- | -------------------------------------------------------- |
| claude-code | codex       | transform | event subset, command-only handlers, placeholder rewrite |
| claude-code | claude-code | symlink   | identity (share between project and user)                |

Transform pairs are derived from the registry: a source must set `transformReadable`, a target must set `transformWritable`, and the two formats must differ. `supportedTransformPairs()`, `formatSupportedTransformPairs()`, and `isTransformSupported(source, target)` expose that matrix so callers can reject unsupported combinations up front instead of failing mid-run.

## Strategy Selection

`bridgeHooks` accepts `strategy: "auto" | "symlink" | "transform"` (default `auto`).

- `auto` picks `symlink` for matching formats and `transform` otherwise. When `symlink` would clobber a user-authored hook file, `auto` resolves to `skip`: the existing file is left untouched, the manifest reports `strategy: "skip"`, and the reason is returned in `warnings` rather than thrown.
- `symlink` and `transform` are explicit requests and fail loudly when they cannot be honored.

## Transform Contract: `claude-code` → `codex`

- Dropped events: `SessionEnd` and `StopFailure` because `codex` does not expose those lifecycle results; `Notification` because `codex` does not expose notification hooks; `PreCompact` and `PostCompact` because `codex` does not expose compaction hooks; `SubagentStart` and `SubagentStop` because `codex` does not expose subagent lifecycle hooks.
- Dropped handler types: `http`, `mcp_tool`, `prompt`, and `agent`; only `command` handlers are emitted.
- Placeholder rewrites: `${CLAUDE_PROJECT_DIR}` → `$(git rev-parse --show-toplevel)`, `${CLAUDE_PLUGIN_ROOT}` → `$PLUGIN_ROOT`, `${CLAUDE_PLUGIN_DATA}` → `$PLUGIN_DATA`.
- Output `statusMessage` prefix: `[generated:poe-code:<runId>] ` exactly.

## Symlink Contract

- Used only when source and target share the registry `format`.
- Replaces a stale symlink or a 100%-generated regular file.
- Refuses to clobber a user-authored file at the symlink path; the error carries `code: "POE_USER_AUTHORED_HOOK_FILE"` so `auto` can skip instead of failing.

## Marker Convention

Callers and external tools identify bridge-generated entries by checking for `statusMessage` starting with the literal `[generated:`. Cleanup keys off the full `[generated:poe-code:<runId>] ` form so concurrent runs do not interfere.

## Cleanup Contract

- Idempotent.
- Removes only entries this run created.
- Removes empty event or matcher groups created by this run; preserves pre-existing empties.
- Removes the `.git/info/exclude` block by `runId` only.

## Producer Wiring

The three call sites that feed the runner's `hooks` option are `poe-code spawn --hooks-from`, pipeline `StepDefinition.hooks`, and ralph step `hooks`.

## Environment Variables

This package reads no environment variables.

## Configuration Options

This package exposes no configuration options.

## Non-Goals

- No bidirectional sync.
- No conversion of opencode/goose plugin code.
- No translation of MCP-tool, HTTP, prompt, or agent handlers into command equivalents; they are dropped.
- No editing of the user's `~/.codex/hooks.json`; the bridge writes project-scope only.
