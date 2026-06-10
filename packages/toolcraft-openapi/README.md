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

`toolcraft-openapi-generate` reads an OpenAPI document from disk or a URL and writes generated command files. Inputs may be OpenAPI 3.x or Swagger 2.0 documents; Swagger query/body parameters are normalized before generation.

- `--input <path-or-url>` — OpenAPI document to read. Defaults to `openapi.json`.
- `--output <dir>` — directory for generated files. Defaults to `src/generated`.
- `--check` — exits non-zero when generated files would change.
- `--inspect` — reports which operations can be generated without writing files.
- `--output-format <terminal|markdown|json>` — output format for `--inspect`. Defaults to `terminal`.

Generated commands preserve original OpenAPI parameter names, use the first tag as the command group, derive stable names from slash-delimited or duplicated `operationId` values, and support common real-world schemas including nullable scalars/enums, object request bodies, same-shape `oneOf`/`anyOf`, and query arrays serialized as `form` or `pipeDelimited`. Unsupported operations are reported as user errors, and `--inspect` can be used before generation to identify them.

### CI drift check

```sh
toolcraft-openapi-generate --check
```

### Inspect compatibility

```sh
toolcraft-openapi-generate --input ./openapi.json --inspect --output-format markdown
```

## Exports

- `bearerTokenAuth(opts)`
- `requestJson(options)`
- `generate(options)`
- `inspectOpenApiDocument(document)`
- `inspectOpenApiSource(source, options?)`
- `renderOpenApiInspection(report)`
- `commandsFromSpec(options)`
- `defineClientFromSpec(options)`
- `HttpError`
- `TokenSource`
- `CommandContributor`
- `AuthProvider`

## Environment variables

- `<envVar passed to bearerTokenAuth>` — bearer token override; wins over stored credentials.
- `AUTH_BACKEND` — forwarded to `auth-store` to select `file` or `keychain` storage.

## Configuration

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
