# toolcraft standalone release notes

## Released packages

| Package | Version | npm |
| --- | --- | --- |
| `toolcraft` | 0.0.1 | `npm install toolcraft` |
| `toolcraft-schema` | 0.0.1 | `npm install toolcraft-schema` |
| `toolcraft-openapi` | 0.0.1 | `npm install toolcraft-openapi` |

## What changed

These three packages are now published as standalone, zero-`poe-code`-dependency packages.

The release keeps the command, schema, and OpenAPI tooling split into separate packages so consumers can install only the pieces they need.

## Migration to standalone imports

| Old package | New standalone package |
| --- | --- |
| `agent-kit` | `toolcraft` |
| `agent-kit/cli` | `toolcraft/cli` |
| `agent-kit/mcp` | `toolcraft/mcp` |
| `agent-kit/sdk` | `toolcraft/sdk` |
| `agent-kit-schema` | `toolcraft-schema` |
| `agent-kit-openapi` | `toolcraft-openapi` |

## Breaking changes for internal consumers

- **`TOOLCRAFT_FIXTURE` env var** is the fixture-mode override used by CLI handlers. Update any test scripts or CI that still rely on older fixture wiring.
- **Root `poe-code` package no longer re-exports these packages** — import from the standalone packages directly.
- **Internal Symbol descriptions** now use the `toolcraft.*` prefix — transparent at runtime unless code serializes or inspects Symbol descriptions.
- **CLI program name fallback** is `"toolcraft"` when running via `node` with no meaningful `argv[1]`.

## OpenAPI generator binary

The `toolcraft-openapi` package exposes the `toolcraft-openapi-generate` binary. Generated code imports from `toolcraft` and `toolcraft-openapi`.
