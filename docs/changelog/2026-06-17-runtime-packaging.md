# 2026-06-17 Runtime Packaging and Surface Cleanup

This entry summarizes the commits that landed on `main` during the 24-hour window ending 2026-06-18 00:40 UTC.

## CLI and SDK surfaces

- Poe generation CLI, SDK, MCP server, and generated-media integration surfaces were removed. The remaining public CLI surfaces now focus on configuring, spawning, reviewing, testing, and operating coding agents.
- Smoke checks were updated to stop asserting the removed generation commands.
- Gaslight now prints the normalized `poe-code spawn ... --resume-thread-id` command after a run when the agent reports a resumable thread id.
- Gaslight leaves completed plan files in place instead of moving them into `archive/`.

## Toolcraft and OpenAPI generation

- `runCLI(root, { argv })` can now run against an explicit argv vector instead of always reading `process.argv`, which lets embedded runners and tests invoke toolcraft CLIs without mutating global process state.
- Toolcraft runtime `UserError`s thrown after parameter parsing now render as direct user-facing failures without a usage pointer, while usage errors still point to the relevant command help.
- Toolcraft preserves requested error output format when errors are rendered before Commander has resolved the action command.
- `toolcraft-openapi-generate` writes and checks an `openapi.lock` file by default, with `--lock <path>` for custom lock-file locations.
- Toolcraft OpenAPI generated commands now expose nested request-body object fields as typed object params instead of falling back to unstructured JSON for ordinary nested objects.

## Package and release hardening

- Package lint now scans runtime file assets from TypeScript source, requires declared or discovered runtime assets to be collocated and packaged, and validates package artifacts without relying on a workspace-local package-lint binary.
- Package lint repo-baseline scanning was moved out of the unit suite and optimized for faster checks.
- Package lint handles the current npm packlist adapter shape and detects bundled public/private workspace dependencies that still require unbundled private packages at runtime.
- Runtime dependencies needed by published packages are declared explicitly, including bundled runtime dependencies for `terminal-pilot` and `toolcraft-openapi`.
- `terminal-pilot` packages its runtime Markdown template asset so installed builds can read it from the published artifact.
