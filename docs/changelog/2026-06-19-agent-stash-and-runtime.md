# 2026-06-19 Agent Stash and Runtime Updates

This entry summarizes the commits that landed on `main` during the 24-hour window ending 2026-06-20 00:00 UTC.

## Agent stash

- Added the private `agent-stash` package for portable skill and hook inventory, copy/move, upload, download, sync, archive import/export, and backup management.
- Added a two-pane interactive browser for comparing project, global, and Gist-backed stash items, with multi-select copy, move, upload, download, and sync actions. Non-interactive browse prints a static resource-browser view.
- Gist-backed transfers now preserve explicit profile and Gist choices, avoid unwanted baseline rewrites, support prototype-named profiles and files, and reject empty or missing selections instead of silently widening them.
- Upload, download, sync, copy/move, and archive import paths honor `.agent-stashignore` or `~/.agent-stash/ignore` rules, validate target paths before writes, and create backups before local mutations.
- Archive imports validate entry paths, entry types, manifest hashes, and tracked files before writing. Backup metadata rejects symlink escapes, stray files, non-directory removals, and symlinked metadata.

## Gaslight and spawn modes

- Gaslight now defaults to spawn mode `auto`, accepts `--mode auto`, resolves `~/...` plan paths against the configured home directory, and reports the resolved plan directory when interactive plan discovery cannot find plans.
- Codex spawn config maps `auto` to its unattended bypass flag so gaslight-style edit runs can proceed without stalling on permission prompts.

## Skills

- `poe-code skill install` installs an arbitrary `SKILL.md` file into a supported agent's native local or global skill directory.
- The `poe-code` SDK now exports `installSkill(...)` with content or file-based sources, injected filesystem support, dry-run support, and the same validation used by the CLI.
- The root bundle now includes the exported `skills` entrypoint, and package lint checks root `main`, `exports`, and `bin` entrypoints for missing runtime dependencies.

## Toolcraft and OpenAPI behavior

- Toolcraft CLI, SDK, and MCP runtimes now pass a shared diagnostic logger to handlers. `runCLI`, `createSDK`, and `runMCP` accept `logLevel` and `logger`, and CLI apps can expose `--log-level` in addition to `--verbose`.
- Toolcraft rejects unknown root default-command targets, renders nested response lists more clearly, and exposes verbose OpenAPI transport diagnostics through generated clients.
- `toolcraft-openapi` preserves hidden handwritten commands when defining generated clients.

## Design system

- `toolcraft-design` added deterministic inspector-card and resource-browser renderers plus a two-pane explorer runtime used by the agent-stash browser.
