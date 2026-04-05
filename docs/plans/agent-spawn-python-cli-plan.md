# Python Spawn SDK

## Goal

Run `poe-code spawn` from Python, get typed events back.

## Architecture

```
Python SDK  ──subprocess──►  OUTPUT_FORMAT=jsonl poe-code spawn  ──stdout──►  parse JSONL → typed events
```

That's it. Python shells out to the CLI and reads JSONL from stdout.

## Step 1: Fix spawn CLI to emit clean NDJSON in `json` mode

`OUTPUT_FORMAT=json` already exists and the ACP renderer (`design-system/src/acp/components.ts`) already emits proper NDJSON. The problem is `spawn.ts` leaks non-JSON output through `logger.intro()` and `logger.info()` calls.

The existing `json` format already produces one JSON object per line:

```jsonl
{"type":"agent","message":"Hello"}
{"type":"tool_start","kind":"edit","title":"src/auth.ts"}
{"type":"tool_complete","kind":"edit"}
{"type":"usage","input":1200,"output":340,"cached":0,"costUsd":0}
```

What needs fixing — suppress non-JSON logger output in `spawn.ts` when format is `json`:
- `logger.intro()` (design headline)
- `logger.info()` (stdout/stderr/completion/resume messages)

Add a final `spawn_result` event emitted after the process completes:

```jsonl
{"event":"spawn_result","exitCode":0,"threadId":"abc123","usage":{"inputTokens":1200,"outputTokens":340},"protocolVersion":1}
```

The Python SDK passes `--yes` when invoking the CLI, so no format-aware logic is needed for interactive prompts.

Also add missing CLI flags to reach parity with the SDK `SpawnOptions`:

- `--log-dir <path>` — directory override for ACP JSONL spawn logs
- `--activity-timeout-ms <ms>` — kill after N ms of inactivity

Align naming across SDK, CLI, and Python:

| SDK | CLI | Python |
|---|---|---|
| `mcpServers` → rename to `mcpConfig` | `--mcp-config` (keep) | `mcp_config` |
| `logDir` | `--log-dir` | `log_dir` |
| `activityTimeoutMs` | `--activity-timeout-ms` | `activity_timeout_ms` |

SDK rename `mcpServers` → `mcpConfig` with backward compat (keep `mcpServers` as deprecated alias).

**Files touched**: `src/cli/commands/spawn.ts`, `packages/agent-spawn/src/acp/types.ts`, `packages/agent-spawn/src/acp/renderer.ts`

## Step 2: Python types (generated via `ts-morph`)

A codegen script in the core package uses `ts-morph` to parse the TS AST and emit Python:

- Reads `packages/agent-spawn/src/acp/types.ts` — walks exported interfaces, extracts field names/types/optionality
- Reads `packages/agent-spawn/src/configs/index.ts` — imports `allSpawnConfigs`, emits `Agent` enum from their `agentId` fields (only spawnable agents)
- Reads `packages/agent-spawn/src/types.ts` — extracts `SpawnMode` union
- Maps TS types to Python: `string` → `str`, `number` → `int`/`float`, `T | undefined` → `Optional[T]`
- Converts camelCase fields to snake_case
- Writes `packages/agent-spawn-py/src/poe_code_spawn/types.py`

Runs as part of the core package build. Output is checked in, CI verifies it's up to date.

Generated output:

```python
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Optional, Union

class Agent(str, Enum):
    CLAUDE_CODE = "claude-code"
    CODEX = "codex"
    OPENCODE = "opencode"
    KIMI = "kimi"

class SpawnMode(str, Enum):
    YOLO = "yolo"
    EDIT = "edit"
    READ = "read"

@dataclass
class SessionStartEvent:
    event: Literal["session_start"]
    thread_id: Optional[str] = None

@dataclass
class AgentMessageEvent:
    event: Literal["agent_message"]
    text: str

@dataclass
class ToolStartEvent:
    event: Literal["tool_start"]
    kind: str
    title: str
    id: Optional[str] = None

@dataclass
class ToolCompleteEvent:
    event: Literal["tool_complete"]
    kind: str
    path: str
    id: Optional[str] = None

@dataclass
class ReasoningEvent:
    event: Literal["reasoning"]
    text: str

@dataclass
class UsageEvent:
    event: Literal["usage"]
    input_tokens: int
    output_tokens: int
    cached_tokens: Optional[int] = None
    cost_usd: Optional[float] = None

@dataclass
class ErrorEvent:
    event: Literal["error"]
    message: str
    stack: Optional[str] = None

@dataclass
class SpawnResultEvent:
    event: Literal["spawn_result"]
    exit_code: int
    thread_id: Optional[str] = None
    usage: Optional[UsageEvent] = None

AcpEvent = Union[
    SessionStartEvent, AgentMessageEvent, ToolStartEvent,
    ToolCompleteEvent, ReasoningEvent, UsageEvent, ErrorEvent,
]
```

Zero dependencies. Generated as part of core package build.

## Step 3: Python SDK

Same API shape as the JS SDK — `spawn()` returns `{ events, result }`, `spawn.pretty()` renders to stdout.

```python
from poe_code_spawn import spawn, Agent

# streaming — mirrors JS: spawn("codex", "Fix the bug")
s = spawn(Agent.CLAUDE_CODE, "Fix the auth bug", cwd="/my/project")

for event in s.events:
    match event:
        case AgentMessageEvent(text=text):
            print(text, end="")

result = s.result
print(f"Exit: {result.exit_code}")

# pretty — mirrors JS: spawn.pretty("codex", "Fix the bug")
result = spawn.pretty(Agent.CLAUDE_CODE, "Fix the auth bug")
print(f"Exit: {result.exit_code}")
```

`spawn()` returns a `SpawnHandle` with `.events` (iterator of `AcpEvent`) and `.result` (`SpawnResultEvent`, available after events consumed).

`spawn.pretty()` runs with `OUTPUT_FORMAT=terminal` (default), inherits stdout rendering, returns `SpawnResultEvent`.

The SDK always passes `--yes` to the CLI so interactive prompts are suppressed. The JSONL parser defensively skips lines that don't parse as JSON (in case of stray output from the CLI).

Cancellation: `SpawnHandle.cancel()` sends SIGINT to the child process (same as ctrl+c). Python callers can also pass a `threading.Event` or similar to trigger cancellation from another thread.

Requires `poe-code` on PATH. When binary not found, raise a diagnostic error:

```
PoeCodeNotFoundError: poe-code CLI not found on PATH.

Environment:
  Python: 3.12.3 (/usr/bin/python3)
  PATH: /usr/local/bin:/usr/bin:...
  Node: v22.1.0 (or "not found")
  npm: 10.7.0 (or "not found")

Install with:
  npm install -g poe-code
```

Include Node/npm versions (or "not found") to help debug env issues.

## Step 4: Package

```
packages/agent-spawn-py/
  pyproject.toml
  README.md
  src/poe_code_spawn/
    __init__.py
    types.py          # generated
    _spawn.py         # spawn() implementation
    _parse.py         # JSONL → typed events
```

`pip install poe-code-spawn` — zero deps, stdlib only.

## Step 5: Publishing

Follow the same pattern as existing package releases (e.g. `release-tiny-mcp.yml`):

**GitHub workflow:** `.github/workflows/release-agent-spawn-py.yml`
- Triggers on: push to `main` affecting `packages/agent-spawn-py/**`
- Uses OIDC trusted publisher (no tokens in secrets) — set up on PyPI
- Auto-bumps patch version in `pyproject.toml`
- Builds with `python -m build`
- Publishes via `pypa/gh-action-pypi-publish` (handles OIDC auth automatically, no tokens needed)

**PyPI trusted publisher setup:**
1. Create project on PyPI
2. Add GitHub as trusted publisher: owner `poe-code`, repo `poe-code`, workflow `release-agent-spawn-py.yml`

**Version strategy:** Python package versions independently from the CLI. The JSONL output format is the stability contract between them. The `spawn_result` event includes a `protocolVersion` field (e.g. `1`) — if the Python SDK sees a version it doesn't recognize, it warns but still attempts to parse.

**CLI resolution order:**
1. `poe-code` on PATH (user's own install)
2. `npx poe-code` fallback (Node is expected to be present)
3. Fail with diagnostic error

This means `pip install poe-code-spawn` just works if Node is available — no separate `npm install -g` step needed. The `npx` fallback handles CI environments where `poe-code` isn't globally installed.

## Status

Plan finalized. Ready for implementation.

## Open Questions

- async API from day one? (`async for event in spawn(...)`)
- PyPI name: `poe-code-spawn` or `poe-code`?
