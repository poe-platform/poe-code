# Agent-Spawn Python CLI Bindings Plan

## Goal

Ship **thin** Python bindings for `@poe-code/agent-spawn` by shelling out to the existing `poe-code spawn` CLI, keeping Python logic minimal and provider-agnostic.

## Non-Goals

- No provider-specific branching in Python.
- No full port of the spawn logic or ACP adapters to Python.
- No changes to README without explicit approval.

## Approach

### 1) Define a machine-friendly CLI contract

Leverage `OUTPUT_FORMAT=json` (already supported in the design system) to switch `poe-code spawn` into a stable, automation-friendly output:

- When `OUTPUT_FORMAT=json`, disable human rendering and write **JSON lines** only.
- Emit ACP events as `{"type":"event", ...}` lines.
- Emit a final line `{"type":"final", ...}` containing `stdout`, `stderr`, `exitCode`, `threadId`, `sessionId`, and `usage`.
- Optional `{"type":"resume", "command": "..."}`

This keeps the CLI the single source of truth and prevents Python from needing to understand providers or adapter formats.

### 2) Python package (thin wrapper)

Create a small Python package in `packages/agent-spawn-py` with:

- `spawn(...)` → runs `poe-code spawn` with `OUTPUT_FORMAT=json`, returns **events stream + final result** (mirrors JS).
- `spawn_streaming(...)` → yields events as they arrive, returns final result when stream ends.
- `spawn_interactive(...)` → runs `poe-code spawn --interactive` with stdio inherit.
- `build_spawn_args(...)` (optional) → calls CLI in dry-run JSON mode (if we add one), or omitted to keep the wrapper thinner.

Only CLI args are constructed in Python; provider behavior remains in the JS CLI.

### 3) Packaging + distribution

- Use a minimal `pyproject.toml` and `src/` layout.
- Expose a single dependency: the `poe-code` executable must be on PATH (or configurable via env var).
- Keep the wrapper cross-platform by avoiding shell-specific features.

### 4) Testing (TDD)

- Unit tests mock the subprocess runner to avoid file IO.
- Verify:
  - argument construction
  - JSON-line parsing
  - streaming iteration + final result handling
  - exit code propagation
- No filesystem writes in tests (exceptions only for snapshots if needed).

## Open Questions

- None (decisions captured: JS-parity events + `packages/agent-spawn-py`).
