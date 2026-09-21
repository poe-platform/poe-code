# mcp-oauth

OAuth client primitives for MCP HTTP transports.

## Usage

```ts
import {
  createAuthStoreSessionStore,
  createDefaultOAuthClientProvider,
  createJwksTokenVerifier
} from "mcp-oauth";

const provider = createDefaultOAuthClientProvider({
  client: { mode: "dynamic" },
  browser: { openBrowser: async (url) => console.log(url) },
  sessionStore: createAuthStoreSessionStore({ serviceName: "mcp-client" })
});

const verifier = createJwksTokenVerifier({
  jwksUrl: "https://example.com/.well-known/jwks.json"
});
```

## Public API

- `createDefaultOAuthClientProvider(options)`: default MCP OAuth client provider with dynamic or static client registration.
- `createOAuthClientProvider(options)`: lower-level provider constructor.
- `createAuthStoreSessionStore(options)`: persisted OAuth session store backed by `auth-store`.
- `createLoopbackAuthorizationSession(options)`: local callback server for browser authorization.
- `generateCodeVerifier()` and `generateCodeChallenge(...)`: PKCE helpers.
- `normalizeStoredOAuthClient(value)`: normalize a saved client identity, full registration and ownership marker.
- `normalizeOAuthScope(value)`: validate scope syntax and normalize its case-sensitive set.
- `canonicalizeResourceIndicator(value)`: resource indicator canonicalization.
- `createJwksTokenVerifier(options)`: JWKS-backed access-token verifier for MCP servers.
- `OAuthError`: OAuth HTTP error type with status, retryability and known-outcome fields.

## Configuration

`createDefaultOAuthClientProvider(options)` accepts:

- `client`
  - `mode: "dynamic"` with optional `metadata`
  - `mode: "static"` with `clientId`, optional `clientSecret`, optional `metadata`
- `allowInteractive: false` prevents interactive login while retaining cached tokens and silent refresh
- `sessionLockTimeoutMs` limits acquisition waits for a session transaction lock (default 30,000 ms; integer from 1 to 2147483647)
- `persistenceNamespace` isolates native sessions and registrations for a named profile (nonempty string, at most 1024 UTF-8 bytes)
- `initialGrant: { resource, tokens }` optionally imports an existing Bearer grant for one HTTP resource; requires the original client ID
- `browser.openBrowser(url)` optional
- `browser.readLine()` optional
- `browser.createServer()` optional
- `browser.landingPage` optional
- `browser.redirectUri` optional exact registered HTTP loopback callback with a fixed port
- `browser.signal` optional cancellation signal
- `browser.timeoutMs` optional authorization deadline (default 120,000 ms)
- `sessionStore` optional
- `authStore` optional `auth-store` backend config for the default session store
- `now()` optional clock override

The default provider captures client, interaction, callback, landing-page and
lock policies when created. Create a new provider to change those settings.
Selected callbacks, stores, clocks and AbortSignals remain live host dependencies;
aborting the original signal still cancels authorization.
Native session and client persistence factories also capture file paths, salts,
Keychain identities, lock locations and selected filesystem/command handles.
Mutating these settings cannot redirect a later read or write.
The factories resolve the selected backend environment variable once at creation;
later environment changes cannot move a transaction between file and Keychain.

`createJwksTokenVerifier(options)` accepts:

| Option                   | Type                | Default        | Description                                                                              |
| ------------------------ | ------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `jwksUrl`                | `string \| URL`     | none           | Authorization server JWKS endpoint.                                                      |
| `clockSkewSeconds`       | `number`            | `30`           | Allowed JWT time-claim clock skew.                                                       |
| `allowedAlgorithms`      | `readonly string[]` | asymmetric set | Allowed JWT signature algorithms.                                                        |
| `jwksCacheTtlMs`         | `number`            | `300000`       | Successful JWKS cache lifetime.                                                          |
| `jwksFetchTimeoutMs`     | `number`            | `5000`         | Timeout for each JWKS HTTP fetch.                                                        |
| `jwksRefreshCooldownMs`  | `number`            | `30000`        | Minimum interval between forced refreshes after an unknown key id.                       |
| `allowInsecureJwks`      | `boolean`           | `false`        | Permit non-HTTPS JWKS URLs. Loopback HTTP URLs are allowed without enabling this option. |
| `requireAccessTokenType` | `boolean`           | `false`        | Require the JWT `typ` protected header to be `at+jwt`.                                   |
| `fetch`                  | `typeof fetch`      | global `fetch` | Custom fetch implementation.                                                             |

Fixed redirects support `localhost`, `127.0.0.1`, and `::1` over HTTP. Their
exact spelling, port, path and query are preserved through registration,
authorization and code exchange. Credentials, fragments, port zero and reserved
OAuth callback query parameters are rejected before binding a listener.
`createDefaultOAuthClientProvider` also checks the configured redirect before
creating the provider. Imported tokens that cannot be sent as HTTP header
values fail with diagnostics that omit their contents. Omit
`redirectUri` to allocate a random loopback port. Standalone callback sessions
accept the same `redirectUri`, `signal` and `timeoutMs` options. Cancellation,
timeout and explicit close settle pending code waits and release listeners.
Always close a successful standalone session in `finally`.

Provider request inputs accept an optional `signal`. It reaches callback waits,
registration, token requests and bounded token-body reads. Cancellation retains
its original reason and does not retry authorization. Custom providers should
observe the supplied signal and pass it to any work they start.

`authorizeRequest` may return an owned token snapshot for the request it
authorized. The HTTP client supplies that snapshot as `presentedTokens`, along
with the actual request's `requestHeaders`, to `handleUnauthorized`. Providers
that return `void` remain supported. The native provider compares the rejected
snapshot with persisted credentials: delayed 401s retry with a newer grant
without redeeming its refresh token again. A proven current token is refreshed
on 401 even when the server omits `error="invalid_token"`. Invalid provenance
fails without quoting token values.

The native provider also exposes `authenticate({ requestUrl, fetch, signal,
discover })` for explicit login, including servers whose initialization is
public. `discover` lazily supplies validated OAuth metadata and is skipped for
usable existing grants. Omit it to recover/reuse known sessions only; the method
returns `void` if a new discovery lookup is needed. It honors `allowInteractive`,
recovers pending refresh outcomes through consent, and returns an owned token
snapshot. Normal transport request authorization remains noninteractive.

`createResourceBoundOAuthStores(authStore, persistenceNamespace, resourceIdentity)`
exposes the native named session/client stores and `reset(resource, { signal,
timeoutMs })`. Reset acquires the raw identity backend lock, so it can recover
corrupt or undecryptable records without reading their old contents. It atomically
retires the identity's grant and registrations and writes a marker that suppresses
stale initial grants. The default lock wait is 30 seconds. Other names/profiles
are untouched, and symlink paths are still refused.

Configure `client.metadata.scope` to request a precise scope set; broader
discovery metadata does not override it. Explicit scopes must match the cached
or imported grant's scope set; ordering, repeated spaces and duplicates are
normalized. An imported grant must declare its scope when a scope is configured.
Authorization records the requested set when the endpoint omits scope, and
refresh retains the previous granted set. Mismatched responses never activate
credentials; an unusable refresh response retains the pending refresh record.
`resourceIdentity` selects a native-owned logical server within its optional
persistence namespace. One encrypted, locked document owns that identity's
current resource URL, sessions and registrations. Changing the URL retires its
credentials permanently; returning to the old URL does not restore them.
Retired identities also withhold stale initial grants; authorize again or select
a fresh explicit profile to import a new grant. This option requires native persistence; custom
session stores own their durable resource trust policy. Without it, the native
client retains its existing resource-URL cache behavior.

Select a separate persistence namespace for another scope profile. No scope is
invented when the client does not configure one.

Imported `initialGrant.tokens` use `accessToken`, optional `refreshToken`,
`tokenType: "Bearer"`, optional `expiresAt` (Unix epoch milliseconds or `null`
if unknown), and optional `scope`. `expiresIn` is a lifetime in seconds and is
anchored once at import. For a delayed import, provide the original `issuedAt`
in epoch milliseconds or its real absolute `expiresAt`; a numeric absolute
expiry takes precedence. Without either, the relative value means remaining
lifetime at import. Omitted expiry stays unknown. A fresh imported token is
used only for its resource.
Discovery binds an expired or explicitly rejected grant before silent refresh,
using the original configured client. Persisted sessions take precedence,
including sessions whose tokens have been cleared; an import cannot revive them.
Input tokens are copied and invalid expiry values fail before authorization.
For a raw OAuth response, `parseOAuthTokenGrant(response, { issuedAt, expiresAt })`
returns normalized `StoredOAuthTokens`. It accepts `access_token`, `refresh_token`,
`token_type`, `scope`, `expires_in` (seconds), `expires_at` (epoch seconds), and
`expiresAt` (epoch milliseconds). Numeric absolute expiry wins over relative
lifetime; the options timestamp wins over response timestamps. The optional
`now` clock anchors a new import. JSON is bounded to 64 KiB/64 levels; malformed
credentials, scope, timing, accessors and non-JSON metadata are rejected without
quoting the input. The parser makes no network or storage requests.
For named native persistence, `createResourceBoundOAuthStores(authStore,
namespace, identity).importSession(session, { signal, timeoutMs })` explicitly
replaces the bound grant and original client in one locked document. It takes
an owned, bounded session snapshot before waiting; validates resource/issuer
binding; marks full registrations as caller-owned; and retires previous clients.
Its durable marker suppresses stale automatic environment imports after tokens
are cleared. Like reset, explicit import can recover a corrupt old document
without decrypting it. The default lock wait is 30 seconds. A session must
contain a complete usable grant and matching validated discovery metadata.
Pass a complete DCR response as `client.registration` (or validate untrusted JSON
with `parseOAuthClientRegistration`). Dynamic clients infer their original ID
and secret from that response and reuse it without registering another app.
Explicit ID/secret values must agree with the imported response. Sessions and
native registration stores retain arrays, issuance/expiry timestamps and JSON
provider metadata. Registration input is copied, bounded to 64 KiB and 64
levels, and rejects invalid standard field types and non-JSON extensions.
An optional registration `issuer` must match discovery and the persisted
authorization server exactly. Contradictory metadata fails without activating
or redeeming the grant. `client_secret_expires_at` uses Unix epoch seconds;
zero means no expiry. Live access tokens remain usable after secret expiry,
but an expired secret is never submitted for refresh. Native DCR can replace
an expired registration during explicit authorization; caller-owned imports
must be updated. Headless requests retain the old record and report recovery
is required without creating a pending refresh marker.
Native registrations retain `requestedRedirectUri`, the actual listener URI
submitted to DCR, separately from the full response metadata. Fresh responses
may normalize a loopback port or represent IPv4 loopback as portless localhost;
host, path, scheme, query and fragment differences outside that boundary fail.
Authorization and code exchange always use the actual listener URI. Silent
refresh keeps its original client regardless of callback changes. At interactive
authorization, a native registration with an obsolete captured callback is
replaced; caller-owned full registration imports retain their original identity.
Their persisted `registrationOwnership: "caller"` survives reload and refresh;
invalid-client responses never silently replace these apps. Callback changes or
expired imported secrets require an explicit registration update.
Set `client.tokenEndpointAuthMethod` to `none`, `client_secret_post` or
`client_secret_basic`; a full registration can supply the same field as
`token_endpoint_auth_method`. Public clients never transmit a stored secret.
Basic credentials are individually form-encoded before Base64 encoding and
are omitted from the form body. Cached grants retain their registered method;
an explicitly different configured method requires separate persistence or a
reset. Native DCR chooses a supported method, preferring public PKCE when
advertised. Unsupported methods and missing confidential secrets fail before
token requests. Existing clients without a method keep the previous default:
body authentication when a secret is present, public authentication otherwise.
Static clients and dynamic initial-grant imports require cached grants to match
the original normalized client ID and secret. A different client configuration
fails before attaching or refreshing credentials and retains the stored record;
select separate persistence or explicitly reset the session to change apps.
Use `persistenceNamespace: "personal"` or `"work"` to keep separate native
profiles for the same resource/issuer. `createAuthStoreSessionStore(options,
namespace)` addresses the same profile when seeding or inspecting credentials.
Namespaces are hashed into file/Keychain identities and transaction locks;
omitting one preserves the default storage keys. Switching namespaces selects a
different record and does not migrate or reset the previous profile. Host-owned
`sessionStore` implementations remain responsible for their own profile keys.

`createAuthStoreSessionStore(options)` accepts the standard `auth-store` config.

Providers sharing the same `sessionStore` object serialize the complete session
read, refresh/authorization and persistence transaction for each resource.
Waiting requests can cancel or time out independently; they cannot release an
active owner's lock. Custom stores may implement
`withLock(resource, operation, { signal, timeoutMs })` to serialize the same
transaction across store instances or processes. The hook must honor acquisition
cancellation and keep the lock until the operation settles. The timeout bounds
acquisition, while token and browser operations retain their own deadlines.
The native `auth-store` session adapter implements this hook for both encrypted
files and Keychain identities, including across independent processes. Locks
cover the complete read, refresh/authorization and persisted winner. Dead-owner
claims are recovered without stealing a live transaction.

Before sending a refresh request, the provider persists a tokenless session with
`refreshState: "pending"`, retaining the original client and discovery binding.
A successful response replaces it with the rotated grant. A crash, cancellation,
network disconnect or incomplete response leaves the marker, so another process
cannot replay a possibly consumed refresh token or revive the initial import.
Such a session requires fresh authorization. Interactive unauthorized handling
can recover it; headless requests fail with an explicit unknown-outcome error.
Only complete OAuth error responses establish a rejected request and allow a
transient retry or restoration of the original grant. Gateway error pages do not.

Native persisted OAuth reads always reject corrupt encrypted documents and
invalid stored JSON, with diagnostics that omit decrypted contents. They retain
the existing record for explicit reset rather than interpreting corruption as
an absent session and reviving an initial grant. Caller file-backend settings
cannot disable this policy.

## Environment Variables

This package exposes no direct environment variables. When `authStore` is used,
`auth-store` honors its own backend environment variables.

Malformed OAuth HTTP errors retain their numeric HTTP status without echoing
response bodies. Raw/incomplete client-error responses (including registration
HTTP 403) are nonretryable `invalid_response` errors; authorization fails without
waiting for consent that never started. Raw server errors remain transient.
`outcomeKnown: false` still withholds an uncertain rotating refresh family: a
nonretryable HTTP status alone does not prove a refresh token was unconsumed.
