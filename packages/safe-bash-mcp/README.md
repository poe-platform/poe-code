# safe-bash-mcp

Turn remote MCP tools into safe-bash commands using the repository's MCP client.
Supply known schemas to skip network discovery, or leave `tools` absent to fetch
every page automatically. Streamable HTTP and legacy HTTP/SSE endpoints are
handled by `tiny-mcp-client`. Discovery tries legacy SSE automatically only when
HTTP connection setup returns 404 or 405. Set `transport: "http"` or `"sse"`
to pin a transport. Local process servers are not supported.

```ts
import { resolveRemoteMcpSchemas } from "safe-bash-mcp";

const schemas = await resolveRemoteMcpSchemas([
  { name: "catalog", url: "https://catalog.example/mcp" },
  { name: "known", url: "https://known.example/mcp", tools: knownTools }
], { signal: controller.signal });
```

An explicitly empty `tools: []` is authoritative and never connects. Returned
schemas are independent copies and retain tool descriptions, annotations,
input/output schemas and other metadata. Discovered snapshots also include
server identity, capabilities and instructions.
Supply `instructions` on a registry entry to keep known server guidance without
discovery. Explicit instructions take precedence over discovered guidance.

| SDK function | Purpose |
| --- | --- |
| `fetchRemoteMcpSchema(server, options)` | Resolve one server's tool schemas |
| `resolveRemoteMcpSchemas(servers, options)` | Preflight a registry and resolve it in order |
| `compileToolArguments(tool, options)` | Compile validated argument parsing and deterministic flag metadata |
| `createRemoteMcpCommands(servers, options)` | Generate safe-bash command definitions |
| `remoteMcpCommands(servers, options)` | Generate a plugin that registers those commands |
| `initRemoteMcpConfiguration(servers, options)` | Create versioned configuration and empty credential templates |
| `parseRemoteMcpConfiguration(value, options)` | Validate and copy configuration from JSON text or an object |
| `bindRemoteMcpConfiguration(value, options)` | Resolve environment references into runtime server credentials |
| `createRemoteMcpManagementCommand(servers, options)` | Create safe-bash configuration, auth, import, reset and artifact commands |
| `authenticateRemoteMcpServer(server, options)` | Establish access explicitly without listing or calling tools |
| `importRemoteMcpAuthentication(server, payload, options)` | Atomically persist raw OAuth tokens with their original app |
| `resetRemoteMcpAuthentication(server, options)` | Retire a named OAuth grant and recover corrupt credential records |
| `generateRemoteMcpArtifact(configuration, options)` | Discover absent schemas and emit reproducible JSON/ESM data |
| `parseRemoteMcpArtifact(value, options)` | Validate artifact size, digest and configuration/schema agreement |
| `remoteMcpArtifactPlugin(artifact, options)` | Bind credentials and register artifact commands without rediscovery |

Use `headers` or the client's `oauth` options for credentials. URLs must use
HTTP or HTTPS without embedded credentials or fragments. Discovery supports
injected `fetch`, OAuth discovery caches, warning callbacks and cancellation.
Set `maxPages`, `maxTools`, `maxResponseBytes` and `requestTimeoutMs` to bound
discovery. Defaults are 100 pages, 10,000 tools, 16 MiB per HTTP response and
30 seconds per request. Request deadlines must not exceed 2,147,483,647 ms;
larger values fail before setup because Node would reduce them to a 1 ms timer.
Cyclic cursors and duplicate tools fail explicitly;
connections close on success, failure and cancellation. Network, authentication,
rate-limit and server errors retain their original cause. If automatic SSE
fallback also fails, the error retains both failures.

For HTTP stack compatibility, pass the host's `HttpTransportFetch` through
`options.fetch`. For example, a host can supply an HTTP/1.1 implementation or
use separate connection pools for long-lived SSE and ordinary requests. The
same implementation handles native MCP requests and OAuth network operations.
Provide it again through `commands.fetch` when loading an artifact; runtime
functions are host dependencies and are not serialized into generated files.

Compile a discovered or supplied tool to parse CLI arguments with its complete
JSON Schema:

```ts
const parser = compileToolArguments(schemas[0].tools[0]);
console.log(parser.parameters); // Exact field names, flags, descriptions and schemas
const args = parser.parse(["--query", "005930"]);
```

Schema-declared strings retain their exact values, including numeric IDs and
timestamps. Numbers, booleans, null, nested objects, unions and typed arrays are
validated before a call. Use `--flag value`, `--flag=value`, `field=value`,
`field:value`, or `field:=<json>` for an explicitly typed JSON value. Flags are
stable across schema key order and remain distinct when names collide with each
other or with `raw`, `yes` and `help`.

Array values accept JSON arrays, repeated flags and JSON item sequences such as
`{"x":1,"y":2},{"x":3,"y":4}`. Bare string elements remain literal, including
commas; use a JSON array or repeat the flag for multiple string elements.
`--raw <json>` accepts a complete object and validates required fields after
parsing. Raw input cannot be mixed with named arguments. Defaults apply only
with `--yes` or the SDK's `{ yes: true }`; explicit falsey values are preserved.
Argument parsing defaults to a 1 MiB input byte limit (`maxInputBytes`). JSON
numbers that would become non-finite or silently round integer literals fail.
Internal and external references use the schema compiler; supply external
documents through its `registry` option.

Register a generated plugin on your shell:

```ts
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { remoteMcpCommands } from "safe-bash-mcp";

const shell = new Shell({ fs: createMemoryFileSystem() });
shell.use(await remoteMcpCommands([
  { name: "catalog", url: "https://catalog.example/mcp", tools: knownTools }
]));
try {
  const result = await shell.exec("catalog search_items --query '005930'");
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

Each server name becomes a command; exact tool names become subcommands.
`catalog --help` lists tools, and `catalog search_items --help` shows arguments.
Help uses supplied or discovered schemas without connecting again. Tool and
server help retain multiline server instructions with terminal
control characters escaped. Artifact loading preserves archived instructions.
For tool names beginning with a dash, use `catalog -- '--tool' [arguments]`.
Use inline flags such as `--query=--help` for literal values beginning with
`--`. `--raw -` and `--raw=-` read a bounded UTF-8 JSON object from virtual
stdin, supporting shell input redirection and pipelines.
For a large or multiline payload, use `catalog search_items --raw - < /input.json`
with a complete JSON object in the virtual filesystem. Named string values
beginning with `@` remain literal.

Stdout contains the complete MCP result as one JSON value, including all content
blocks, structured output and metadata. Tool failures and invalid structured
output return exit code 1; invalid arguments return 2 before connecting. Protocol
and transport errors produce JSON diagnostics on stderr with codes, data and
HTTP status when available. Output writes are awaited and cancellation closes
owned requests. Set `maxOutputBytes` to bound command output (default 16 MiB).
Output schemas and external schema registrations are captured during generation.
Registration checks all command conflicts before registering any of them.
Save the full response with `catalog search_items --query example > /response.json`.
Redirection writes to the shell's virtual filesystem and preserves the response.

Prepare credential configuration without reading secrets or connecting:

```ts
import { initRemoteMcpConfiguration, createRemoteMcpManagementCommand } from "safe-bash-mcp";

const servers = [{
  name: "catalog", url: "https://catalog.example/mcp",
  auth: {
    type: "oauth" as const, clientMode: "static" as const,
    env: { clientId: "GOOGLE_APP_ID", clientSecret: "GOOGLE_APP_SECRET" },
    scope: "read offline_access", redirectUri: "http://localhost:39119/callback"
  }
}];
const { configuration, envTemplate } = initRemoteMcpConfiguration(servers);
const management = createRemoteMcpManagementCommand(servers);
// Register management with your shell's CommandRegistry.
```

`mcp init` prints `{ configuration, envTemplate }` as JSON. Use
`mcp init --format config` or `mcp init --format env` for separate outputs that
can be redirected to files. `mcp init --help` explains the available formats.
OAuth requires an explicit `clientMode: "static"` or `"dynamic"`. Set optional
public `auth.clientName` to retain the application's display name in configuration
and artifacts; native dynamic registration sends it as `client_name`.
Templates
include client ID/secret, scope, redirect URL, access/refresh tokens and expiry
in Unix epoch milliseconds. Every template value is empty; public scope and
redirect defaults remain in configuration. Bearer tokens and arbitrary headers
also use explicit `{ env: "VARIABLE_NAME" }` references. Reference names are
plain variable names; configuration does not interpolate `${VAR}` or
`${env:VAR}` strings. Literal credentials
and unknown configuration fields are rejected. Supplied schemas remain
authoritative, including an empty tool list.

Bind configuration explicitly when preparing runtime commands:

```ts
import { bindRemoteMcpConfiguration, createRemoteMcpCommands } from "safe-bash-mcp";

const runtimeServers = bindRemoteMcpConfiguration(configuration, {
  env: environmentSnapshot,
  oauth: { allowInteractive: false }
});
const commands = await createRemoteMcpCommands(runtimeServers);
```

Binding reads only own data properties of the supplied environment; it never
falls back to `process.env`. Required missing variables fail before provider
setup, and empty optional values use public fallbacks or remain absent. Values
are captured independently from later environment changes. Credential inputs
have a 1 MiB combined byte limit (`maxCredentialBytes`); shared references count
once. Binding produces runtime credentials separately from the configuration
used in artifacts. Do not serialize runtime server entries as configuration.

OAuth uses the native provider and defaults to headless operation. Set
`oauth.allowInteractive: true` and `oauth.browser.openBrowser` to enable login.
Configured scope and exact redirect values come from environment references or
their public fallbacks. Supply `oauth.sessionStore(server)` for host-owned
persistence, or `oauth.authStore` for the native secret-store backend.
`oauth.sessionLockTimeoutMs` bounds transaction lock acquisition (default 30 s).
Set `auth.tokenEndpointAuthMethod` to `none`, `client_secret_post` or
`client_secret_basic` to select token authentication. This public setting is
preserved by init and generated artifacts; credentials remain environment
references. Basic authentication form-encodes app credentials and sends them
only in its authentication header. Public authentication omits the app secret.

Set `auth.persistenceNamespace` on an OAuth server in initialization or
configuration to select a named native credential profile. Different namespaces
keep separate grants and registrations even at the same URL; omitting one keeps
the default storage identity. Profiles are public configuration values and do
not add credential environment variables. Host-owned stores select their own
profile identities and implement their own durable URL trust history. Native
binding additionally uses the configured server name as its logical identity:
changing its URL retires saved sessions and registrations, and reverting the
URL does not revive them. A retired identity withholds old environment-token
imports; authorize it again to establish a new grant.
Existing access-token imports require the original client ID; refresh-token/expiry fields
require an access token. `expiresAt` is a decimal Unix epoch millisecond value.
Optional `expiresIn` references supply lifetime in seconds, anchored once at
binding. For a delayed import, supply its original epoch millisecond `issuedAt`
or real absolute expiry; absolute expiry takes precedence. Without issuance
time, a relative lifetime means remaining lifetime at binding. Init emits empty
`EXPIRES_IN` and `ISSUED_AT` entries; older configs without them remain valid.
Persisted rotated or cleared grants take precedence over imported environment
tokens. A fresh import avoids discovery; an expired or explicitly rejected grant
binds validated discovery before refreshing with its original client.
OAuth metadata, registration and token requests negotiate JSON independently
from MCP Accept, tenant and protocol headers.

Authenticate one configured server explicitly, including when its tool schemas
are supplied:

```ts
import { authenticateRemoteMcpServer } from "safe-bash-mcp";

await authenticateRemoteMcpServer(configuration.servers[0], {
  binding: { env: environmentSnapshot },
  onAuthorizationUrl({ authorizationUrl, redirectUri }) {
    console.log(authorizationUrl, redirectUri);
  }
});
```

`mcp auth catalog` prints the complete authorization URL and exact redirect
before waiting for consent. Keep the command running while opening the URL.
If a process manager ends its child process group, use a persistent terminal,
tmux or a supervisor so the callback listener survives until consent completes.
It defaults to headless operation; `--no-browser` and `--browser none` select
that explicitly. `--browser host` uses the host's configured browser opener.
The SDK exposes the same selection through `noBrowser` (default `true`).
Headless SDK login requires an `onAuthorizationUrl` callback when consent is
needed; cached access can succeed without one. Existing uncertain refresh
outcomes can be recovered through a new consent flow.

`--json` streams one `{ authorizationUrl, redirectUri }` JSON record per consent
attempt. After any URL output, the connection summary goes to stderr; otherwise
stdout contains `{ name, url, connected: true }`. Summaries omit remote server
metadata and credentials. Use `--timeout-ms <milliseconds>` or SDK
`requestTimeoutMs` to bound the complete operation (default 120,000 ms).
Authentication verifies initialization, establishes the configured OAuth grant
even if initialization is public, and never lists or calls tools. A fresh
connection verifies newly established access after public initialization.
Management `options.authentication` accepts SDK settings and an optional binding;
without a host binding it uses the command's environment. For names beginning
with a dash, put options first and use `mcp auth --json -- '-catalog'`.

Use `mcp auth catalog --reset` or SDK `{ reset: true }` to retire old OAuth tokens
and registrations before new consent. `mcp reset catalog` performs reset alone,
without reading credential environment values or connecting. `--json` emits
`{ name, url, reset: true }`; `--timeout-ms` controls the lock wait (default
30,000 ms). The SDK counterpart is `resetRemoteMcpAuthentication(server, {
binding: { oauth: { authStore } }, timeoutMs })`; its binding does not require an
environment. Management `options.reset` accepts these settings and otherwise
uses the authentication binding's persistence.

Native reset works even when an encrypted credential document is corrupt. It
holds the same identity lock as refresh and authorization, replaces the selected
name/profile's record with a tokenless marker, and prevents old environment
imports from reviving the reset grant. Other names/profiles remain independent.
Host-owned persistence requires `binding.oauth.reset(server, { signal,
timeoutMs })`; the host must retire its credentials and durably suppress stale
imports. Static bearer/header values remain controlled by the host environment.

Seed credentials obtained by a headless OAuth owner without computing store keys:

```ts
await importRemoteMcpAuthentication(server, {
  tokens: tokenResponse,
  clientInfo: fullDcrResponse,
  issuedAt: originalIssuedAtMs // Optional for a delayed relative-lifetime import
}, { binding: { env: {}, oauth: { authStore } } });
```

Use `mcp import catalog < /credentials.json` or
`mcp import catalog --file /credentials.json --json` for the same operation.
Paths belong to the safe-bash virtual filesystem; `--file -` explicitly selects
stdin. `--json` emits the public import summary. `--timeout-ms` bounds input,
discovery and persistence (default 30,000 ms). `mcp import --help` shows payload
and expiry guidance. Management `options.credentialImport` supplies SDK settings
and otherwise uses the authentication binding's persistence or shell environment.
The host's `maxInputBytes` also bounds credential input (default 1 MiB).

The import discovers and validates OAuth metadata, then atomically saves the
original client and grant for the configured name/profile. It does not initialize,
list or call tools. Full DCR metadata stays encrypted and caller-owned; dynamic
clients infer their original ID/secret. When `clientInfo` is absent, provide the
original app through the configured client environment references. Static mode
requires its configured ID; explicitly configured IDs/secrets must match the
import. Configured scope must match the grant. An optional payload `issuer` and
registration issuer must match discovery exactly.

Raw token fields follow OAuth: `access_token`, `refresh_token`, `token_type`,
`scope`, and `expires_in` in seconds. Absolute `expiresAt` uses epoch milliseconds;
`expires_at` uses epoch seconds. Absolute expiry wins; relative lifetime is
anchored before network waits, using original payload `issuedAt` milliseconds
when supplied. Old token, timing and header environment values are never read.
The SDK returns only `{ name, url, imported: true }`. Default complete-operation
and lock limits are 30 seconds (`requestTimeoutMs` and `timeoutMs`). Input defaults
to 1 MiB (`maxImportBytes`), with token/DCR JSON separately bounded to 64 KiB.
Malformed JSON diagnostics never quote input. Host-owned persistence requires
`binding.oauth.importSession(server, session, { signal, timeoutMs })`; that hook
owns atomic client/grant installation and durable stale-import suppression.

Generate a reusable artifact from declarative configuration:

```ts
import { generateRemoteMcpArtifact, remoteMcpArtifactPlugin } from "safe-bash-mcp";

const generated = await generateRemoteMcpArtifact(configuration, {
  binding: { env: environmentSnapshot },
  schema: { signal: controller.signal }
});
// Persist generated.json or generated.module with your host's file API.
shell.use(await remoteMcpArtifactPlugin(generated.artifact, {
  binding: { env: environmentSnapshot }
}));
```

`mcp generate` prints the JSON artifact. Use `--format config` for resolved
configuration or `--format module` for an ESM data module that exports the
artifact as default. Shell redirection works for all formats. Host-selected SDK
generation settings are available as management `options.generation`; discovery
uses the command's environment unless the host supplies an explicit binding.

Server/tool ordering and nested JSON keys are stable; semantic arrays retain
their order. Artifacts contain no generation timestamp, temporary filesystem
path or resolved credential values. Only absent schemas require credential
binding and network discovery. Server identity, capabilities, instructions,
annotations and complete input/output schemas remain in the snapshot.
Supply external JSON Schema documents with generation `schemaRegistry`; they
are snapshotted before discovery, included in the digest, and loaded without
separate host registrations. Missing references fail generation. An archived
registry is authoritative: host `commands.schemaValidation.registry` may repeat
identical archived documents, but additions or changed documents fail before
credential binding. Custom format functions remain host-supplied through
`commands.schemaValidation.formats`. Older artifacts without a registry still
accept a host registry.
Generation refuses discovery metadata or external documents that echo a known resolved credential, including
persisted/rotated grants observed during authorization, with safe diagnostics.

The ESM data module has no dependency imports and can be loaded from any working
directory. Runtime commands use the host's installed `safe-bash-mcp` library and
explicit environment binding; every schema is supplied, so loading does not
rediscover tools. The parser checks a SHA-256 content digest and snapshot/config
agreement before touching credentials. `maxArtifactBytes` bounds generated JSON
and modules individually, and parsed artifacts (default 32 MiB). Existing
configuration, discovery, cancellation and credential limits still apply.

CLI OAuth failure summaries keep the HTTP status, recognized recovery code,
retryability and known-outcome flags. Provider descriptions, error URIs and
unknown extension codes are withheld because they can reflect app/token
credentials. Direct SDK OAuthError objects remain intact for host observers.
Other MCP protocol error codes/data and ordinary failure causes are preserved.
