# agent-kit standalone release notes

## Released packages

| Package | Version | npm |
| --- | --- | --- |
| `agent-kit` | 0.0.1 | `npm install agent-kit` |
| `agent-kit-schema` | 0.0.1 | `npm install agent-kit-schema` |
| `agent-kit-openapi` | 0.0.1 | `npm install agent-kit-openapi` |

## What changed

These three packages were previously internal to the `poe-code` monorepo under the `@poe-code/cmdkit*` namespace and were not published to npm. They are now published as standalone, zero-`poe-code`-dependency packages.

The internal workflow/runtime package that was previously named `@poe-code/agent-kit` was renamed to `@poe-code/agent-harness-tools` to free up the `agent-kit` name.

## Migration from old internal names

| Old import | New import |
| --- | --- |
| `@poe-code/cmdkit` | `agent-kit` |
| `@poe-code/cmdkit/cli` | `agent-kit/cli` |
| `@poe-code/cmdkit/mcp` | `agent-kit/mcp` |
| `@poe-code/cmdkit/sdk` | `agent-kit/sdk` |
| `@poe-code/cmdkit-schema` | `agent-kit-schema` |
| `@poe-code/cmdkit-openapi` | `agent-kit-openapi` |

## Breaking changes for internal consumers

- **`CMDKIT_FIXTURE` env var renamed to `AGENT_KIT_FIXTURE`** — used to activate fixture mode in CLI handlers. Update any test scripts or CI that set `CMDKIT_FIXTURE`.
- **Root `poe-code` package no longer re-exports these packages** — any code importing `poe-code/agent-kit`, `poe-code/cmdkit`, etc. must update to import from the standalone packages directly.
- **Internal Symbol descriptions** updated from `cmdkit.*` to `agent-kit.*` — transparent at runtime; only affects code that serializes or inspects Symbol descriptions.
- **CLI program name fallback** changed from `"cmdkit"` to `"agent-kit"` — applies only when running via `node` with no meaningful argv[1].

## OpenAPI generator binary

The `agent-kit-openapi` package exposes the `agent-kit-openapi-generate` binary (previously `cmdkit-openapi-generate`). Generated code imports from `agent-kit` and `agent-kit-openapi`.
