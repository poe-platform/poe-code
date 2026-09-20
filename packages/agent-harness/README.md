# @poe-code/agent-harness

Shared harness loader, template, schema, and runtime orchestration APIs for `.md` + `.ajs` SafeJS harness pairs. This private workspace package is not included in the published `poe-code` package.

## Public API

- `runHarnessPair(mdPath, options)` resolves the matching `.ajs` file, validates frontmatter against any exported `schema`, lints the script, and runs it through `@poe-code/safe-js`.
- `listBuiltinTemplates()` returns bundled template pairs: `ralph-demo`, `coverage-demo`, `experiment-demo`, `pipeline-demo`, and `superintendent-demo`.
- `extractSchema(source, filename)` reads a harness script's exported schema for frontmatter validation.
- `resolvePair(mdPath)` resolves the Markdown/script pair for a harness document.
- `LintError` wraps lint diagnostics raised before execution.

## Harness pairs

A harness is a Markdown document plus a sibling `.ajs` script. The Markdown frontmatter configures the run; the body is passed to the harness import metadata. The `.ajs` file must export a default entry point and may export `schema` to validate frontmatter before execution.

`runHarnessPair` injects the `schema` module, wraps host modules for deterministic replay across resumes, and writes snapshots. Successful ordinary runs clean up completed snapshots; migrated runs retain a completed checkpoint and its ancestry so a later resume does not start fresh.

## Snapshots and resume

Pass `snapshotPath` to control where snapshots are read and written. `resume` defaults to `true`; set `resume: false` to remove a completed snapshot and force a fresh run. If a snapshot exists, the underlying SafeJS source hash must still match the `.ajs` source.

The former `poe-code harness` CLI is unavailable. Use the workspace API directly.

## Built-in templates

`listBuiltinTemplates()` exposes template metadata with `kind`, `mdPath`, and `ajsPath`.

## Environment Variables

This package does not read any environment variables.

## Configuration

This package does not read package-level configuration. Runtime behavior is supplied through `runHarnessPair` options: `modulesFor`, `allowedGlobals`, `budget`, `resume`, `signal`, and `snapshotPath`. `budget` accepts a SafeJS `Budget`; current failure checkpoints never raise limits automatically. See [SafeJS recovery](../safe-js/RECOVERY.md) for budget and checkpoint behavior.
