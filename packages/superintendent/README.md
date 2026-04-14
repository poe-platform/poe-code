# @poe-code/superintendent

Cmdkit-first scaffold for the superintendent workflow package.

This package will host the superintendent document model, orchestration runtime, CLI commands, MCP tools, and SDK exports described in `docs/plans/superintendent.md`.

## Current scaffold

- `src/commands/` contains placeholder cmdkit groups for `superintendent`, `builder`, and `inspector`.
- `src/document/` contains stub modules for document parsing and writing.
- `src/runtime/` contains stub modules for runtime orchestration entry points.
- `src/cli.ts` and `src/mcp.ts` wire the cmdkit CLI and MCP runners.

## Usage

CLI entrypoint during development:

```sh
npx tsx packages/superintendent/src/cli.ts --help
```

MCP entrypoint during development:

```sh
npx tsx packages/superintendent/src/mcp.ts
```

Installed MCP binary:

```sh
poe-superintendent-mcp
```

## SDK

Current SDK exports the placeholder command groups:

- `superintendentGroup`
- `builderGroup`
- `inspectorGroup`

## Environment variables

This scaffold does not currently read or expose any package-specific environment variables.

## Config options

This scaffold does not currently expose package-specific configuration options.
Future document frontmatter and runtime options will be documented here as they are implemented.
