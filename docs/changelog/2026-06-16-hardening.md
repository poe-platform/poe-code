# 2026-06-16 Hardening and Documentation Updates

This entry summarizes the commits that landed on `main` during the 24-hour window ending 2026-06-17 00:39 UTC.

## CLI and SDK behavior

- Dry-run commands now validate the same inputs they would use during execution instead of silently recovering from malformed config, missing harness files, missing runtime assets, invalid active skills, or missing credentials.
- Numeric CLI options are parsed as plain decimal values. Values with suffixes, prefixes, fractions where integers are required, or non-finite numbers are rejected before the command starts.
- `configure`, `unconfigure`, `provider`, `models`, `usage`, `memory`, `pipeline`, `runtime`, `launch`, `generate`, and `spawn` paths validate user-provided filters, identifiers, files, credentials, and dry-run inputs before doing work.
- Authentication helpers reject malformed identity responses instead of treating them as valid credentials.
- `unconfigure` removes provider/service metadata from the selected config layer and reports no-op dry runs when there is no matching configuration.
- Generated-media cleanup ignores ordinary Markdown links, so only generated media links are considered for cleanup.

## Spawn, providers, and agents

- Spawn-time MCP config parsing is shared between the CLI and SDK, including standard `.mcp.json` `@file` input, blank-name/blank-command rejection, and provider-specific serialization limits.
- Agent spawn model overrides must be non-blank, and MCP bridge resources are cleaned up if temporary MCP file setup fails.
- Provider registry definitions are validated for non-blank ids, duplicate ids, and duplicate API-key storage keys. Provider model input definitions are frozen before export.
- Poe provider base URLs are normalized through the resolved API-shape path so shape-specific URLs stay consistent across CLI, SDK, and stored config.
- Poe Agent rejects blank prompts, invalid iteration limits, empty allowed path lists, malformed session ids, malformed persisted sessions, inherited-only tool properties, local-only fetch URLs, and write-capable shell commands while running in read mode.

## Runtime, workspaces, and sandboxes

- Process runner Docker inputs now validate port mappings, workspace upload size limits, Docker wait exit-code output, detached-command completion markers, and command runtime state before use.
- Process launcher log following emits the bounded initial log window before streaming appended output.
- Docker and E2B template hashes honor `.dockerignore`, so ignored files do not invalidate a template cache.
- Runtime job exit codes are accepted only when serialized as canonical numeric values.
- E2B runtime config rejects host mounts, ignores blank API-key environment values so project config can resolve, maps host subdirectory working directories into the sandbox workspace, and rebuilds instead of reusing blank cached template ids.
- Workspace resolver rejects missing or non-directory local paths, checks out requested Git refs as revisions, and cleans up a worktree directory if `git worktree add` fails after creating it.
- Worktree helpers reject unsafe worktree names, allow the normal macOS `/var` system alias for registry paths, and restore registry state if Git removal fails.

## Documents, plans, and task workflows

- Frontmatter parsing reports diagnostics with original source offsets, accepts opening fences with trailing whitespace, returns delimiter diagnostics for missing closing fences, and rejects non-object YAML roots when writing frontmatter.
- Markdown reader treats leading thematic breaks as Markdown body text, ignores heading-like lines inside HTML comments, rejects empty file/section inputs, and prefers numbered section paths over unnumbered numeric headings.
- Config-extends trims path-valued `extends`, keeps frontmatter-only prompts intact, treats a leading horizontal rule as prompt body, rejects blank partial names, and resolves prototype-named partials as own entries.
- Pipeline plans enforce schema invariants, reject unknown task properties, reject empty step names, keep empty step keys runnable, and restrict document variables to files inside the project root.
- Ralph, experiment-loop, maestro, superintendent, and task-list validate frontmatter, workflow config, state names, event names, list names, task ids, issue ids, and metric values before running or mutating documents.
- Plan discovery includes YAML pipeline plans, skips broken symlinks, and parses editor commands while preserving escaped spaces.
- Agent harness workflow discovery skips symlinked workflow documents, honors reloaded workflow iteration limits, transfers workspaces with the same gitignore semantics as process-runner, and writes logs for same-basename plans into distinct directories.

## Integrations and tooling

- GitHub workflow automation validates MCP commands, required secrets, TruffleHog finding limits, and workflow inputs before running generated jobs.
- GitHub review helpers normalize PR URLs, inline-comment paths, comment bodies, deleted-line targets, repository names, and review-history timestamps before shelling out to `gh`.
- Braintrust integration trims required config strings and omits impossible or non-finite telemetry metrics instead of publishing invalid rows.
- Config mutations reject primitive merge values, avoid rewriting unchanged serialized content, and refuse to create, back up, or chmod through symlinked targets.
- Package lint now requires every package under `packages/*` to have a package-local `README.md` that documents exposed environment variables and config options, and it catches stale or unbundled workspace dependency ranges before release.
- Toolcraft help hides internal default commands, renders compact enum choices in option help, validates CLI/MCP/SDK/preset-file inputs through shared schema constraints, and declares the process-runner runtime dependency needed by published packages.
