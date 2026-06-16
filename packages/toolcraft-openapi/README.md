# toolcraft-openapi

tools for agents and humans

Scaffold for OpenAPI-driven toolcraft clients.

## Usage

```ts
import { bearerTokenAuth, requestJson } from "toolcraft-openapi";

const auth = bearerTokenAuth({
  serviceName: "internal-agent",
  envVar: "INTERNAL_AGENT_TOKEN",
  whoamiPath: "/whoami"
});
```

## Generator CLI

`toolcraft-openapi-generate` reads an OpenAPI document from disk or a URL, writes generated
command files.

- `--input <path-or-url>` — OpenAPI document to read. Defaults to `openapi.json`.
- `--output <dir>` — directory for generated files. Defaults to `src/generated`.
- `--check` — exits non-zero when generated files would change.
- `--diff` — prints the generated file changes without writing them.

When `toolcraft.yml` is present next to the input file, the generator validates it, prints
diagnostics, and uses it to shape generated command names for mapped resources. Error diagnostics
stop normal writes as well as `--check` runs; fix the config before regenerating.

The default generated integration point is `src/generated/client.ts`. Application code should
provide deployment-specific configuration and let the generated client own the full OpenAPI-derived
command surface:

```ts
import { defineGeneratedClient } from "./generated/client.js";
import { bearerTokenAuth } from "toolcraft-openapi";

export const client = defineGeneratedClient({
  name: "internal-agent",
  baseUrl: "https://api.example.com",
  auth: bearerTokenAuth({
    serviceName: "internal-agent",
    envVar: "INTERNAL_AGENT_TOKEN"
  })
});
```

Generated lower-level group and operation exports remain available for consumers that intentionally
want a curated command surface with `defineClient()`.

### CI drift check

```sh
toolcraft-openapi-generate --check
```

## Exports

- `bearerTokenAuth(opts)`
- `requestJson(options)`
- `validateArrayJsonHelperValue(value, definition, label)`
- `HttpError`
- `readToolcraftConfig(path)`
- `validateToolcraftConfig(value)`
- `mergeToolcraftConfig(base, override)`
- `diagnose(config, document)`
- `formatDiagnostic(diagnostic)`
- `formatDiagnostics(diagnostics)`
- `resolveOpenApiBaseUrl(options)`
- `mockFetch(options)` from the `toolcraft-openapi/mock` subpath for spec-backed test doubles.
- `DIAGNOSTIC_CODES`
- `TokenSource`
- `CommandContributor`
- `AuthProvider`

## Environment variables

- `<envVar passed to bearerTokenAuth>` — bearer token override; wins over stored credentials.
- `AUTH_BACKEND` — forwarded to `auth-store` to select `file` or `keychain` storage.
- `TOOLCRAFT_OPENAPI_ENV` — selects a configured OpenAPI environment when using
  `resolveOpenApiBaseUrl`.

## Configuration

### `toolcraft.yml`

`toolcraft.yml` lives next to `openapi.json`. Without it, OpenAPI-only generation remains the
default.

```yaml
edition: 2026-05-16

client_settings:
  idempotency_header: Idempotency-Key

pagination:
  cursor:
    request: { cursor: cursor, limit: limit }
    response: { items: data, next_cursor: meta.next_cursor }

resources:
  messages:
    methods:
      list: get /messages { pagination: cursor }
      create: post /messages { idempotent: true }

unspecified_endpoints:
  - get /internal/health
```

Supported keys:

- `edition` — required when `toolcraft.yml` exists. Currently `2026-05-16`.
- `environments` — named base URLs for `resolveOpenApiBaseUrl`.
- `client_settings.idempotency_header` — header used for generated idempotency keys.
- `client_settings.auth.*.env` — declarative auth environment metadata.
- `pagination` — named request/response field mappings. Schemes are validated today; iterator
  generation is not implemented yet.
- `resources` — resource/method mapping. Mapped methods shape generated names and file paths.
- `readme.examples` — examples emitted into generated command help and MCP descriptions.
- `unspecified_endpoints` — endpoints intentionally omitted from `resources`.

Mapped idempotent methods with `client_settings.idempotency_header` get an optional
`idempotencyKey` param across CLI, MCP, and SDK surfaces. Mapped methods also get a CLI/SDK
`rawResponse` param that returns `{ data, response }`; the CLI accepts both `--raw-response` and
`--raw`.

Generated JSON helper params for arrays validate `minItems` and `maxItems` before dispatch. For
OpenAPI compositions where every equivalent `oneOf`/`anyOf` branch has enum values, generation
preserves the merged enum values in the resulting schema.

Diagnostics use stable codes:

- `TOOLCRAFT_OPENAPI_001` — endpoint is not mapped or listed in `unspecified_endpoints`.
- `TOOLCRAFT_OPENAPI_002` — duplicate configured method path.
- `TOOLCRAFT_OPENAPI_003` — unknown pagination scheme.
- `TOOLCRAFT_OPENAPI_004` — reserved for spec drift.
- `TOOLCRAFT_OPENAPI_005` — reserved method name.
- `TOOLCRAFT_OPENAPI_006` — missing or unsupported edition.
- `TOOLCRAFT_OPENAPI_007` — invalid config shape.

### Mock fetch

`toolcraft-openapi/mock` exports `mockFetch(options)` for tests. It matches requests against an
OpenAPI document, records requests, validates path/query/header parameters and request bodies, and
validates response fixtures against exact or range response schemas such as `2XX`.

### `bearerTokenAuth(opts)`

- `serviceName: string` — auth-store service name and file-store key.
- `envVar: string` — environment variable checked before stored credentials.
- `whoamiPath?: string` — optional authenticated endpoint used by `login` and `status`.
- `commandPrefix?: string` — CLI auth group name. Defaults to `auth`.

## Auth commands

`bearerTokenAuth()` contributes a CLI-only `<commandPrefix>` group with:

- `login`
- `logout`
- `status`
