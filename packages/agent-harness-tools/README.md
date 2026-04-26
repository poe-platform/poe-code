# @poe-code/agent-harness-tools

Reusable runtime components for autonomous single-document workflows.

This package is intended to hold shared runtime building blocks for agent-driven workflows that operate on a single source document or plan.

## Status

Shared helpers are exported from `src/index.ts` as they are added.

## Loop agent selection

`resolveLoopAgent` is the shared selector used by loop-style runners to choose a single agent specifier.

Precedence:

- CLI flag via `providedAgent`
- frontmatter string via `frontmatterAgent`
- `configuredDefaultAgent` from `core.defaultAgent`
- `fallbackAgent` when `assumeYes` / `--yes` is enabled
- interactive `select(...)` prompt

Notes:

- Only a single frontmatter string is handled here. If frontmatter contains an array, the caller must resolve that case before calling `resolveLoopAgent`.
- Validation and alias resolution happen inside the helper. Supported `agent:model` specifiers keep their model suffix.
- Cancellation is only possible in the interactive prompt path. If `select(...)` returns a value that `isCancel(...)` recognizes, the function returns `{ cancelled: true }` and does not throw. Callers are responsible for showing the cancellation message and stopping the command cleanly.
- `pipeline`, `experiment`, `ralph`, and `superintendent` all route their single-agent loop selection through this function so the precedence stays aligned across commands.

## Configuration

This package does not read config files directly, but Poe Code callers commonly pass `configuredDefaultAgent` from merged `core.defaultAgent`.

- User config: `~/.poe-code/config.json` → `core.defaultAgent`
- Project config: `./.poe-code/config.json` → `core.defaultAgent`

## Environment Variables

This package does not read environment variables directly, but Poe Code callers commonly source `configuredDefaultAgent` from:

- `POE_DEFAULT_AGENT` → overrides file-backed `core.defaultAgent` values and then feeds `configuredDefaultAgent`
