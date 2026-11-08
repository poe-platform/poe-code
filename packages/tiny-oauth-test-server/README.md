# tiny-oauth-test-server

`tiny-oauth-test-server` is a tiny OAuth 2.0 authorization server fixture for tests, demos, and manual smoke runs against MCP clients.

It is intentionally not a production authorization server.

The package serves the minimum OAuth authorization-server endpoints an MCP client needs:

- `GET /.well-known/oauth-authorization-server`
- `POST /register`
- `GET /authorize`
- `POST /token`
- `GET /.well-known/jwks.json`

Access tokens are real signed JWTs and the package publishes a matching JWKS.

The implementation uses `jose` for JWT and JWKS interoperability, while key generation and signing keys come from `node:crypto`.

## Quick Start

### Programmatic

```ts
import { createOAuthTestServer } from "tiny-oauth-test-server";

const server = createOAuthTestServer({
  defaultTokenTtlSeconds: 60
});

const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });

console.log(server.issuer);
console.log(`${server.issuer}/.well-known/oauth-authorization-server`);

const token = await server.issueTokenFor({
  clientId: "demo-client",
  resource: "https://resource.example.com/mcp",
  scopes: ["mcp.read"]
});

console.log(token);

await handle.close();
```

### CLI

```sh
npx tiny-oauth-test-server \
  --auto-approve \
  --static-client demo-client:http://127.0.0.1:43123/callback
```

On startup the CLI prints:

- the bound URL
- the issuer URL
- the authorization-server metadata URL to publish from protected-resource metadata
- a `curl` example for the test-only direct token helper endpoint

## Public API

### `createOAuthTestServer(options?)`

Creates an in-memory authorization server.

Default behavior:

- random signing key
- ephemeral port
- `60` second access token TTL
- DCR required for non-static clients
- no static clients

Returns an object with:

- `listen({ port?, hostname? })`
- `issuer`
- `issueTokenFor({ clientId, resource, scopes, ttlSeconds? })`
- `setNextAuthorization({ autoApprove, scopes? })`
- `revoke(token)`

### `listen({ port?, hostname? })`

Starts the HTTP server and resolves to:

- `url`: bound base URL
- `port`: bound TCP port
- `close()`: async shutdown helper

### `issuer`

The issuer URL used in metadata documents and JWTs.

If `issuer` was not provided in `createOAuthTestServer(options)`, this becomes available after `listen()`.

### `issueTokenFor({ clientId, resource, scopes, ttlSeconds? })`

Directly mints an access token without going through browser authorization.

This is useful for tests that need a valid JWT quickly.

### `setNextAuthorization({ autoApprove, scopes? })`

Overrides the next authorization decision.

- `autoApprove: true` approves the next `/authorize` request without rendering the consent page
- `scopes` changes the granted scopes for the next authorization request

### `revoke(token)`

Marks a previously issued access token or refresh token as revoked in the server's in-memory state.

## Configuration Options

| Option                   | Default                  | Description                                                                                                                                  |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuer`                 | none                     | Issuer URL to publish in metadata and JWTs. If omitted, the server uses the runtime listening URL.                                           |
| `signingKey`             | none                     | Private signing key as a PEM string or private JWK object. Supports P-256 EC (`ES256`) and RSA (`RS256`).                                    |
| `signingKeySeed`         | none                     | Deterministic seed for generating a reproducible ES256 key at startup. Ignored when `signingKey` is provided.                                |
| `clockSkewSeconds`       | `0`                      | Extra skew allowed when validating authorization-code and refresh-token expiry.                                                              |
| `defaultTokenTtlSeconds` | `60`                     | Default `expires_in` for access tokens.                                                                                                      |
| `requireDcr`             | `true`                   | When `true`, non-static clients must register before `/authorize`. When `false`, unknown public clients are accepted for loopback redirects. |
| `staticClients`          | `[]`                     | Preloaded clients. Each item is `{ clientId, redirectUris, scopes? }`.                                                                       |
| `defaultAuthorization`   | `{ autoApprove: false }` | Default consent behavior. Useful for CLI auto-approval. Supports `{ autoApprove?, scopes? }`.                                                |

## CLI Options

| Option                                                       | Default     | Description                                                                                |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------ |
| `--port <port>`                                              | `0`         | Port to listen on. `0` requests an ephemeral port.                                         |
| `--hostname <hostname>`                                      | `127.0.0.1` | Hostname to bind to.                                                                       |
| `--issuer <url>`                                             | none        | Issuer URL to publish in metadata and JWTs.                                                |
| `--ttl-seconds <seconds>`                                    | `60`        | Access token TTL in seconds.                                                               |
| `--auto-approve`                                             | `false`     | Auto-approve every authorization request.                                                  |
| `--static-client <client_id:redirect_uri[,redirect_uri...]>` | none        | Register a repeatable static client. Provide the flag multiple times for multiple clients. |

## Endpoints

### Spec endpoints

| Method | Path                                      | Description                                     |
| ------ | ----------------------------------------- | ----------------------------------------------- |
| `GET`  | `/.well-known/oauth-authorization-server` | RFC 8414 authorization-server metadata          |
| `POST` | `/register`                               | RFC 7591 dynamic client registration            |
| `GET`  | `/authorize`                              | Consent page or auto-approval redirect          |
| `POST` | `/token`                                  | `authorization_code` and `refresh_token` grants |
| `GET`  | `/.well-known/jwks.json`                  | Public verification keys                        |

### Test-only helper endpoint

| Method | Path                   | Description                                                                                                                                   |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/testing/issue-token` | Calls the same direct access-token minting path as `issueTokenFor(...)` and returns an RFC 6749-shaped token response without a refresh token |

Example:

```sh
curl -sS -X POST http://127.0.0.1:43111/testing/issue-token \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"demo-client","resource":"https://resource.example.com/mcp","scopes":["mcp.read"]}'
```

## Token Behavior

- access tokens are JWTs signed with `ES256` or `RS256`
- `iss` is the server issuer URL
- `aud` is the requested `resource`
- `scope` is the granted scope string
- access tokens default to `60` seconds
- refresh tokens rotate on every successful refresh
- authorization codes are single-use

## Environment Variables

This package does not require any environment variables.

## License

MIT
