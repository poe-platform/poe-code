# toolcraft-openapi

Generate Toolcraft command clients from OpenAPI documents and share the same
surface across CLI, MCP, and SDK usage.

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

`toolcraft-openapi-generate` reads an OpenAPI document from disk or a URL and
writes generated command files.

- `--input <path-or-url>` - OpenAPI document to read. Defaults to `openapi.json`.
- `--output <dir>` - directory for generated files. Defaults to `src/generated`.
- `--check` - exits non-zero when generated files would change.
- `--diff` - prints generated file changes without writing them.

When `toolcraft.yml` is present next to the input file, the generator validates
it, prints diagnostics, and uses it to shape generated command names for mapped
resources.

The default generated integration point is `src/generated/client.ts`.
Application code provides deployment-specific configuration and lets the
generated client own the OpenAPI-derived command surface:

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

Generated lower-level group and operation exports remain available when callers
want a curated command surface with `defineClient()`.

## Live runtime clients

`defineClientFromSpec()` materializes the same OpenAPI command model at process startup without
writing generated source files:

```ts
const client = await defineClientFromSpec("https://api.example.com/openapi.json", {
  name: "internal-agent",
  baseUrl: "https://api.example.com",
  auth,
  cache: {
    onFallback: (message) => process.stderr.write(`${message}\n`)
  }
});
```

HTTP sources use a cross-process disk cache by default when the built-in `fetch` is used.
Successful documents remain fresh for the server's `Cache-Control: max-age`, or five
minutes when the server does not provide one. Stale entries revalidate with `If-None-Match` when
an ETag is available. Fetching and reading the response have a three-second timeout; a transport
failure or timeout uses the last successfully materialized document. HTTP errors and invalid live
documents still fail visibly.

Runtime source options:

- `cache: false` - disables HTTP source caching and offline fallback.
- `cache.directory` - absolute cache directory override.
- `cache.maxAgeMs` - fallback freshness when the response does not define cache behavior.
- `cache.onFallback(message)` - reports when a stale document is used after a transport failure.
- `onTimeout({ source, timeoutMs, usingCachedDocument })` - application hook for presenting
  network-access guidance without coupling the library to a specific network or VPN.
- `timeoutMs` - total HTTP fetch/body timeout. Defaults to `3000`; `0` disables it.

Supplying a custom `fetch` disables automatic caching unless `cache` is explicitly provided. Use a
different `cache.directory` for each identity when explicitly caching authenticated custom fetches.
A custom filesystem participates when it provides `realpath` and the cache write operations;
read-only filesystems still load the live document without persisting it. New cache entries are
committed only after the command tree materializes successfully.

### CI drift check

```sh
toolcraft-openapi-generate --check
```

## Exports

- `bearerTokenAuth(opts)`
- `requestJson(options)`
- `HttpError`
- `readToolcraftConfig(path)`
- `validateToolcraftConfig(value)`
- `mergeToolcraftConfig(base, override)`
- `diagnose(config, document)`
- `formatDiagnostic(diagnostic)`
- `formatDiagnostics(diagnostics)`
- `resolveOpenApiBaseUrl(options)`
- `DIAGNOSTIC_CODES`
- `TokenSource`
- `CommandContributor`
- `AuthProvider`

## Environment Variables

- `<envVar passed to bearerTokenAuth>` - bearer token override; wins over stored credentials.
- `AUTH_BACKEND` - forwarded to `auth-store` to select `file` or `keychain` storage.
- `TOOLCRAFT_OPENAPI_ENV` - selects a configured OpenAPI environment when using
  `resolveOpenApiBaseUrl`.
- `TOOLCRAFT_OPENAPI_CACHE_DIR` - absolute directory for live HTTP OpenAPI cache entries.
- `TOOLCRAFT_OPENAPI_CACHE` - set to `0` or `false` to disable the default live HTTP cache.
- `XDG_CACHE_HOME` - cache root fallback; defaults to `~/.cache`.

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

- `edition` - required when `toolcraft.yml` exists. Currently `2026-05-16`.
- `environments` - named base URLs for `resolveOpenApiBaseUrl`.
- `client_settings.idempotency_header` - header used for generated idempotency keys.
- `client_settings.auth.*.env` - declarative auth environment metadata.
- `pagination` - named request/response field mappings. Schemes are validated today; iterator
  generation is not implemented yet.
- `resources` - resource/method mapping. Mapped methods shape generated names and file paths.
- `readme.examples` - examples emitted into generated command help and MCP descriptions.
- `unspecified_endpoints` - endpoints intentionally omitted from `resources`.

Mapped idempotent methods with `client_settings.idempotency_header` get an optional
`idempotencyKey` param across CLI, MCP, and SDK surfaces. Mapped methods also get a CLI/SDK
`rawResponse` param that returns `{ data, response }`; the CLI accepts both `--raw-response` and
`--raw`.

Diagnostics use stable codes:

- `TOOLCRAFT_OPENAPI_001` - endpoint is not mapped or listed in `unspecified_endpoints`.
- `TOOLCRAFT_OPENAPI_002` - duplicate configured method path.
- `TOOLCRAFT_OPENAPI_003` - unknown pagination scheme.
- `TOOLCRAFT_OPENAPI_004` - reserved for spec drift.
- `TOOLCRAFT_OPENAPI_005` - reserved method name.
- `TOOLCRAFT_OPENAPI_006` - missing or unsupported edition.
- `TOOLCRAFT_OPENAPI_007` - invalid config shape.

### `bearerTokenAuth(opts)`

- `serviceName: string` - auth-store service name and file-store key.
- `envVar: string` - environment variable checked before stored credentials.
- `whoamiPath?: string` - optional authenticated endpoint used by `login` and `status`.
- `commandPrefix?: string` - CLI auth group name. Defaults to `auth`.

## Auth commands

`bearerTokenAuth()` contributes a CLI-only `<commandPrefix>` group with:

- `login`
- `logout`
- `status`
