# toolcraft-openapi

tools for agents and humans

Scaffold for OpenAPI-driven toolcraft clients.

## Usage

```ts
import { bearerTokenAuth, requestJson } from "agent-kit-openapi";

const auth = bearerTokenAuth({
  serviceName: "internal-agent",
  envVar: "INTERNAL_AGENT_TOKEN",
  whoamiPath: "/whoami"
});
```

## Generator CLI

`agent-kit-openapi-generate` reads an OpenAPI document from disk or a URL, writes generated
command files, and stores the current spec hash in `openapi.lock`.

- `--input <path-or-url>` — OpenAPI document to read. Defaults to `openapi.json`.
- `--output <dir>` — directory for generated files. Defaults to `src/generated`.
- `--lock <path>` — lock file path. Defaults to `openapi.lock`.
- `--check` — exits non-zero when generated files or `openapi.lock` would change.

### CI drift check

```sh
agent-kit-openapi-generate --check
```

## Exports

- `bearerTokenAuth(opts)`
- `requestJson(options)`
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
