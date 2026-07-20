# `poe-spawn`

Stdlib-only Python SDK for `poe-code spawn`.

## Install

```bash
pip install poe-spawn
```

The package does not bundle the CLI. It resolves the executable in this order:

1. `poe-code` on `PATH`
2. `npx --yes poe-code`
3. `PoeCodeNotFoundError` with Python, `PATH`, Node, and npm diagnostics

## Usage

```python
from poe_spawn import Agent, AgentMessageEvent, spawn

handle = spawn(Agent.CODEX, "Fix the auth bug", cwd="/repo")

# or spawn against a GitHub repository
handle = spawn(Agent.CODEX, "Fix the auth bug", cwd="github://owner/repo#main")

for event in handle.events:
    if isinstance(event, AgentMessageEvent):
        print(event.text, end="")

result = handle.result
print(result.exit_code)
```

`handle.events` yields typed ACP events parsed from JSONL stdout. The final `spawn_result`
record is stored on `handle.result` after the iterator is fully consumed.

```python
from poe_spawn import Agent, spawn

result = spawn.pretty(Agent.CLAUDE_CODE, "Summarize the failing tests")
print(result.exit_code)
```

`spawn.pretty(...)` runs with terminal rendering enabled, inherits the child stdout/stderr,
and returns a synthesized `SpawnResultEvent` with the child exit code.

## API

### `spawn(agent, prompt, **kwargs)`

Keyword options:

- `cwd: str | None` - Working directory or workspace locator. Supports local paths and `github://owner/repo[#ref[:subdir]]`. Passed to `poe-code spawn --cwd`
- `model: str | None` - Passed to `--model`
- `mode: SpawnMode | str | None` - Passed to `--mode`; omission uses the shared `auto` default
- `args: Sequence[str] | None` - Extra agent CLI args appended after the prompt
- `mcp_servers: Mapping[str, Any] | None` - Serialized to `--mcp-servers`
- `mcp_config: Mapping[str, Any] | None` - Deprecated alias for `mcp_servers`
- `log_dir: str | None` - Passed to `--log-dir`
- `activity_timeout_ms: int | None` - Passed to `--activity-timeout-ms`
- `cancel_event` - Optional event-like object with `wait()` or `is_set()`; when triggered, sends `SIGINT` to the child

Return value:

- `SpawnHandle.events` - Iterator of `AcpEvent`
- `SpawnHandle.result` - Final `SpawnResultEvent`, available after event consumption
- `SpawnHandle.cancel()` - Sends `SIGINT` to the child process

## Environment Variables

The package does not define its own configuration env vars. It relies on:

- `PATH` - Used to resolve `poe-code`, `npx`, `node`, and `npm`
- `OUTPUT_FORMAT` - Overridden for child processes by the SDK:
  - `spawn(...)` forces `json`
  - `spawn.pretty(...)` forces `terminal`

Any other CLI/provider environment variables are inherited from the current process.

## Configuration Options

All configuration is passed as `spawn(...)` keyword arguments: `cwd`, `model`, `mode`, `args`, `mcp_servers`, `log_dir`, `activity_timeout_ms`, and `cancel_event`. The SDK always adds `--yes` and does not read a Python config file.

## Notes

- The SDK always passes `--yes` to suppress interactive prompts.
- JSONL parsing is defensive: malformed lines are skipped.
- Runtime dependencies are stdlib only.
