# MCP Rust implementation investigation

Date: 2026-09-19. Repository inspected: `1a9316310` on local `main`.
Status: implementation active. The reusable `mcp-protocol-rust` JSON foundation
is implemented, including a tested napi-rs JSON binding; MCP package rewrites
and the complete poe-agent dependency rewrite are in progress.
An additive native server checkpoint now covers sessions, tool callbacks, direct
value conversion, request admission, cancellation, modern result metadata, and
stdio framing/backpressure. Content now includes binary and resource blocks,
annotation validation, structured primitives on modern explicit results, and
ordinary tool failures versus explicit `ToolError` responses.
A first callback-heavy benchmark is recorded below. Consumer integration and
publication have not been performed; transports and complete server conformance
remain in progress. The format foundation cross-checks canonical base64 padding
bits and resource URI syntax/authorities against the TypeScript implementation.
Complete Unicode IDNA mapping, contextual joining, combining marks, and bidi host
rules remain an explicit conformance gap; the current host checks are not a full
replacement for WHATWG URL processing. Full server API/result compatibility remains pending.

The JSON foundation now formats binary64 values with ECMAScript shortest notation,
fixed/exponent boundaries and exact decimal midpoint ties using integer arithmetic.
It retains distinct text versus JSON handling for NaN/infinities and negative zero.
Boundary/subnormal/extreme cases and 32,768 deterministic bit-pattern samples are
cross-checked against V8. A separate development audit matched 1,048,047 finite
binary64 samples byte-for-byte across 24,556,503 bytes (native parse/serialize about
323 ms on this machine; this is not a comparison benchmark). Foundation checks now
include 44 Rust and 18 native tests. Schema diagnostics now use the same number
formatter for numeric bounds/divisors and length/count constraints; differential
checks cover notation boundaries and midpoint values. Tool number text, nested
JSON content and object/scalar output-schema fallbacks now match JavaScript
shortest spelling across legacy and modern calls. The server checkpoint passes
59 Rust and 312 native tests with these regressions included.

The server now embeds the existing normative MCP 2026-07-28 schema data with its
upstream licensing/source notices and a reproducible development generator. Own
Rust schema evaluation validates protocol definitions, client capabilities and
retry responses, rejecting malformed retry fields before handler invocation.
URI/base64 and metadata/extension key formats use the own protocol foundation;
`ListRootsResult` also enforces valid file roots. The public native validator
rejects non-JSON input without executing accessors or serialization hooks.
Each cached validator retains only transitively referenced definitions; a local
fresh-process audit of all sixteen validators changed RSS growth from 5.31 MiB to
1.98 MiB and initialization from 11.48 ms to 6.51 ms. These single process endpoints
are not peak/leak evidence or a general backend comparison. Rust input-required
capability/sequence validation now runs on actual tool/prompt/resource handler
results. Invocation capability snapshots survive caller/handler mutations and
concurrent calls, and are freed only when callbacks settle. Valid requirements
bypass complete output contracts and resource cache defaults; malformed non-JSON
requirements return RPC errors without executing getters. Opaque retry state and
input responses reach handlers through direct sessions, wire messages, stdio and
official SDK in-memory transports. The expanded package checks include 62 Rust
and 323 native tests, including concurrent worker use of cached capability/retry
validators and cancellation/reused-ID snapshot cleanup checks.

The server exposes independent Rust `defineSchema` construction and inferred
TypeScript argument types. Shorthand tool registration now accepts output schemas
and rejects duplicate names like the reference; whitespace-only names remain
permitted. Differential tests reproduce the prior missing helper, ignored output
schema, duplicate replacement and whitespace rejection. In-flight contract tests
now replace registrations via removal followed by registration, matching the
reference public API. The package check expands to 326 native tests.

Synchronous Image/Audio/File helpers now use own Rust media detection, MIME rules,
base64 encoding/decoding and content construction. File UTF-8 decoding strips the
leading BOM and replaces malformed sequences; text retains UTF-16 input verbatim.
File byte inputs preserve live mutation semantics, while binary helpers snapshot
inputs. Branded helpers convert in nested tool arrays without invoking overridden
methods. Descriptor conversion preserves cycles, holes, accessors and serialization
hooks for safe native rejection. Differential tests cover all eleven magic-byte
signatures, every truncation, unaligned byte slices, MIME aliases, noncanonical
helper base64 versus canonical protocol content, text/binary MIME families, byte
mutation, 512 seeded base64 lengths and 4096 seeded malformed UTF-8 samples.
The package checks expand to 333 native tests at this synchronous checkpoint.

All three media helpers now expose bounded remote factories. Node's built-in fetch
handles I/O and its platform decoder supports remote charsets; own Rust code owns
MIME/header parsing and bounded byte accumulation. No advertised content length
preallocates memory. Overflow discards retained bytes and permanently rejects later
chunks, cancels the reader, and preserves lock cleanup. Error labels omit credentials,
queries and fragments. Mocked in-memory responses cross-check signature/header
precedence, Windows-1252/UTF-16/UTF-8 and unsupported charset fallback, HTTP failures,
declared/streamed/array-buffer limits and every invalid byte budget against TypeScript.
Checks now include 63 Rust and 336 native tests; no live network fixtures are used.

The public `toContentBlocks` converter now uses own Rust content classification,
JSON serialization and number formatting with a Node adapter for array descriptors,
host identities and own-descriptor class fallback. Recognizable content is preserved
before protocol validation, including intentionally invalid URI/base64 examples.
Tests cross-check primitives, nested/shared/cyclic/sparse/accessor arrays, non-JSON
leaves, class/null prototypes, object identity, branded helpers and first-error order.
Content classes also work through actual tool handlers. Checks expand to 343 native
tests. A development microbenchmark found batching native conversion calls did not
improve scalar arrays, so that experiment was removed. Direct native text construction
uses the platform primitive intrinsic and retains JS strings without an owned JSON
copy; structured values still use own Rust conversion. Own fields bypass prototype
setters. Local Rust medians changed from 0.55 to 0.37 us for one scalar and 46.42 to
29.18 us for 100 scalars. TypeScript remained faster (about 0.095 and 4.40 us in the
final trial); these single-process samples establish
no general Rust speed advantage. Evidence is in `out/rust-content-converter-*.json`.

MCP parameter-header contracts now compile at tool registration in own Rust code.
Static nested string/integer/boolean paths, ASCII token names, case-insensitive
duplicates, safe integers and canonical UTF-8/base64 mirrors match the reference.
Modern direct requests reject mismatches before handlers with error -32020;
legacy requests and omitted transport header contexts retain their existing behavior.
Native header copying uses own descriptors without invoking field getters, and
proxy reentrancy occurs before borrowing server state. Contracts are snapshotted.
Checks expand to 66 Rust and 347 native tests, including malformed/encoded headers,
unsupported annotation locations and safe getter/reentrancy behavior.

The schema Rust package now exposes legacy nullable normalization, implemented in
the reusable std-only core. Resource IDs/dialects, schema maps/arrays, dynamic and
pointer references, escaped/percent-encoded paths and non-schema annotations match
the reference normalizer. Differential normalized shapes and validator acceptance
cover nested resources, draft-seven identifiers, dynamic/recursive anchors and
nullable tuples. Host hooks/getters/cycles remain safely rejected. Normalization
has bounded schema traversal. The schema checks include 26 Rust tests and 657
native test groups (the full 2226 official cases remain included).

Tool registration now normalizes both schemas before compiling, snapshotting or
deriving header contracts. Native/reference cross-checks cover shorthand and full
registration, listings, null acceptance and structured-result validation in both
protocol modes. Invalid nullable roots and unreachable nullable header annotations
reject without partial registration. The server passes 66 Rust and 349 native tests.

Shared tool admission now uses an own Rust bounded FIFO queue with Node wake-up
and timer adapters. Defaults (four active, 64 queued), configured/zero waiting,
overflow errors, cancellations and response timeouts match the reference behavior.
Running callbacks retain both tool slots and global request identity after timeout
until actual settlement; expired waiters do not execute. Session abort fan-out uses
one listener instead of per-request session listeners. Tests cover direct sessions,
official SDK in-memory interoperability, repeated success/failure listener cleanup
and fake-clock timeout/identity retention. Older tests now wait for handler startup
rather than relying on one microtask. A prior completed-tool signal assertion was
corrected against concrete reference evidence: admission signals remain un-aborted
after successful completion. The expanded checks pass 68 Rust and 356 native tests.

The server now exposes every existing public runtime export, including frozen
JSON-RPC error codes, and the named protocol/handler/definition TypeScript contracts.
A maintained compile fixture imports those contracts, exercises typed registration
and assigns the native server to the reference Server interface. SDK transport
overloads retain both the repository interface and official SDK acceptance without
runtime SDK imports. Explicit input generics retain ordinary ToolReturn defaults.
The package unit route now includes these static fixtures; runtime checks expand
to 357 native tests alongside 68 Rust tests. This API checkpoint does not resolve
the documented URI/regex completeness gaps or complete the remaining package ports.

The additive `tiny-mcp-client-rust` package now has a std/path-only Rust core and
self-contained napi-rs addon. Its initial client envelope parser handles requests,
notifications and success/error responses independently of server admission rules.
Native/reference checks cover invalid envelope combinations, preserved IDs,
fractional/overflow numbers, duplicate JSON fields, UTF-16 and arbitrary JSON
params. Error diagnostics use the public McpError class. This is a parsing checkpoint,
not complete client parity: lifecycle, requests/retries, transports, subscriptions
and OAuth remain in progress. No production imports or releases change.

The client now includes an independent Rust message-layer state machine and native
Node stream/callback adapter. Rust owns exchange limits, monotonic safe request
IDs, response matching, batch admission, incoming callback capacity, cancellation
and disposal. Legacy outgoing requests expose timers, caller signals and ID/timeout
hooks; callbacks validate normative input requests/responses with the own server
core. Tests cross-check TypeScript behavior for out-of-order replies, error data,
timeouts, early cancellation hooks, malformed results, retained canceled callbacks,
notification-before-batch admission and late-write suppression. Native client
initialization/listing/tool calls work against both Rust and TypeScript stdio servers.
The maintained check includes 6 Rust and 10 native tests plus TypeScript fixtures.
Modern complete/input-required result processing, request retries, complete client
lifecycle and standalone transports are still pending. Stream decoding currently
uses the Node platform decoder with bounded line framing in the adapter.

Modern client result processing and retry state now live in own Rust code. Known
results validate normative schemas; cacheable methods enforce ttlMs/cacheScope.
Input requirements validate capability/transcript rules before selecting registered
handlers. Roots/sampling/elicitation callbacks use one exchange signal; responses
validate before retries preserve original argument snapshots, replace opaque retry
fields and allocate fresh IDs. The 64-round/64-input limits match the reference.
Tests cover canceled callback waits, retained exchange capacity, stale state removal,
argument mutation, invalid roots, aggregate missing subcapabilities and pre-aborted
requests. Check coverage expands to 8 Rust and 18 native tests plus type fixtures.
Full client lifecycle, subscriptions, HTTP/stdio adapters and OAuth remain pending.

The public `McpClient` now uses an owned Rust connection state with generation
guards, legacy initialization and modern discovery validation, cloned server
snapshots, callback-derived capabilities and reconnect support. Its Node adapter
exposes tool/resource/prompt/completion calls, progress tracking, cancellation,
roots changes, logging, ping and cleanup. Differential native tests exercise both
clients against both server implementations/protocol versions, discovery fallback
and terminal negotiation errors, invalid capabilities before network I/O, legacy
roots/elicitation callbacks, stale closure after reconnect and canceled progress.
Maintained TypeScript fixtures cover the new public contracts. This checkpoint
does not include notification streams or resource subscriptions; those and
standalone transports/OAuth remain required before client parity is complete.

Client notification-stream filters, acknowledgement admission/subset checks,
tagged notification selection, completion correlation and the 64-stream cap now
live in a separate reusable Rust core. The native adapter owns acknowledgement
timers, promises and abort listeners. `McpClient` automatically subscribes configured
list-change callbacks and supports explicit streams plus legacy/modern resource
subscribe/unsubscribe. Concurrent resource calls coalesce without an aborted waiter
canceling other callers; canceled setup can retry and completed streams reopen.
Cross-checks cover premature/bad-ID completion, malformed filters, expanded filters,
pre-abort, timeout, capacity recovery, cancellation and immutable native snapshots.
End-to-end notifications pass for both clients, both servers and both protocols.
Standalone stdio/HTTP/SDK transports, OAuth and additional edge auditing remain.

Standalone in-memory transport pairs and stdio process transports now use own
Node platform I/O with zero npm runtime dependencies. The reusable Rust stderr
tail retains at most 65,536 UTF-16 units, including raw/split surrogates, while the
platform decoder incrementally handles byte chunks. Tests cross-check spawn
arguments/environment, closure idempotence, stream/process errors, exit metadata,
UTF-8/BOM/end-of-stream behavior, already-exited/killed children and 256 seeded
malformed byte samples. In-memory transports exchange bytes and preserve closure
reasons. A manual default-spawn check reads actual process stdout, stderr and exit
code without fixture files. HTTP/SDK transports and OAuth remain in progress.

An independent Rust SSE core now frames CR/LF/CRLF (including split CRLF),
filters event types, preserves UTF-16 fields/cursors and discards incomplete EOF
events. It bounds both individual lines and accumulated event data/metadata by
UTF-8 bytes. Metadata byte counts are cached; event data uses one bounded buffer
rather than retaining a vector per data line. Napi tests compare every split point
of ten framing fixtures, malformed limits, comment streams, aggregate/Unicode
overflow and 128 seeded event streams against the original parser. Flush preserves
the completed cursor and releases partial-event buffers. This is an internal
framing checkpoint, not a completed HTTP transport. Checks include 18 Rust and
42 native test groups plus maintained public TypeScript fixtures.

The own Rust HTTP-response correlation core now enforces originating request IDs,
single completion, notification admission, acknowledgement ordering and subscription
completion metadata. Subscription methods cannot enter unrelated request streams;
progress tokens use JavaScript's strict primitive equality, rejecting structurally
equal object/array tokens. Error envelopes with null/missing IDs normalize only
under the reference's eligibility rules, preserving ECMAScript numeric property
ordering recursively and stringify behavior for overflow numbers/UTF-16. Native
oracle tests reproduce and fix object-token and property-order differences, plus
fractional/string/zero IDs, invalid envelopes and cross-subscription messages.
Checks expand to 21 Rust and 45 native groups plus public type fixtures. The fetch
adapter, HTTP lifecycle/reader ownership, SDK adapter and OAuth remain required.

Own SDK-compatible linked message transports and byte/message adapter now support
`createSdkTestPair` without importing the official SDK at runtime. Rust parses wire
objects and serializes descriptor-copied JSON; Node owns platform streams and
transport callbacks. Pre-start message queues are bounded at 128. `createTestPair`
uses own in-memory streams. Both helpers pass tool/list/call/ping checks against
the official SDK or own Rust server and clean up after a client's setup failure.
Native malformed-line diagnostics preserve raw UTF-16. Public type fixtures accept
official Server instances and own clients/servers without runtime dependencies.
Additional SDK factory/server failure and hostile callback/serializer diagnostics
remain for auditing; HTTP transport and OAuth remain incomplete.

Validated SDK/stream test-pair cleanup gaps are now fixed in the additive client:
client factories run inside the setup guard, synchronous/asynchronous server
startup failures dispose transports without unhandled rejections, and rejected
client close operations still execute disposal in `finally`. Focused tests first
reproduced open transports after factory/close failures, then verified SDK close
callbacks and stream ends, preserving setup errors and awaiting cleanup.
Hostile callbacks/serializer diagnostics remain for further conformance auditing.

The additive private `mcp-oauth-rust` package now has a std/path-only Rust core,
self-contained napi-rs addon, zero npm runtime dependencies and public PKCE types.
Own unpadded base64url/SHA-256 computes RFC7636 S256 challenges; Node supplies
operating-system-backed entropy for 32-byte verifiers. The Rust core passes
empty/abc/million-a SHA-256 vectors and the RFC PKCE vector. Native/reference tests
cover surrogate/BOM conversion, every 0..255 padding length, 1,024 seeded binary
hash inputs and 1,024 seeded UTF-16 verifier strings. The maintained package
build/lint/type routes pass; no existing consumer or release wiring changes.
Authorization state, client/token/browser/session/JWKS functionality remains
required before OAuth package parity is complete.

Authorization-state creation/parsing now lives in the own Rust OAuth core with
16-byte host entropy, version/nonempty nonce/issuer/boolean checks, owned fields
and own JSON/base64url codecs. The decoder reproduces Node's mixed alphabet,
ignored-junk, early-padding and UTF-16 low-byte lookup behavior. Native/reference
tests cover field validation, issuer/BOM/surrogate round trips, decorated valid
states, 1,024 malformed UTF-8/base64 states and 1,024 direct arbitrary UTF-16
byte-decoder comparisons. No prototype lookup can supply decoded fields. This is
an internal state checkpoint; token/browser/provider/session/JWKS parity remains.

Own Rust HTTP response budgets now validate safe limits, exact decimal declared
lengths and bounded chunk counts, remaining rejected after overflow. Node's host
adapter owns strict incremental UTF-8 decoding, reader tracking/lock release,
abort cancellation and redirect refusal. Native/reference checks cover invalid
limits, BOM/split Unicode at exact byte boundaries, invalid UTF-8, ignored malformed
lengths, oversize declared/actual lengths, redirects, pre/mid-read abort and reader
cleanup. Public wrappers preserve plain Error shapes rather than leaking napi's
GenericFailure code on validation errors. Maintained public type fixtures cover
both helpers. Browser/provider/session/JWKS functionality remains pending.

Token exchange and refresh now use own Rust field validation, ECMAScript UTF-16
trimming, Date-range expiry arithmetic, form encoding and OAuth error extraction
and retry classification. Node supplies fetch, the 30-second deadline and clock;
the clock is only invoked for valid present expiry fields. Responses are bounded
at 1 MiB and return own fields, including undefined optional token properties.
Regression tests first reproduced inherited native-envelope contamination and
verify the boundary ignores inherited optional and error fields. Native/oracle
checks cover grants, request secrets/Unicode/surrogates, all protocol error aliases,
512 seeded token strings and 512 expiry calculations, malformed UTF-8, byte limits
and abort reasons. The maintained build/lint/type checks and nine Rust / eighteen
native groups pass. Full URL/IDNA normalization still uses the Node host primitive.

Loopback callback binding, input normalization and exact UTF-16 HTML escaping now
use the own Rust core. The Node host listens only on 127.0.0.1 with an ephemeral
port, supports configured paths/browser/manual input and supplies platform URL
parsing. Native/oracle tests cover HTTP response bodies/status/headers, callback
state and issuer priority, denials, empty codes, pasted URLs/raw codes, browser
rejection reasons (including undefined), and startup errors. Close intentionally
improves on the original lifecycle: it rejects pending waits, is idempotent and
removes only owned request listeners. 512 settlement/close cycles verify no owned
listeners remain. The focused maintained build/lint/types and twelve Rust / twenty-
four native groups pass. Provider/session/JWKS functionality remains incomplete.

The additive private `auth-store-rust` prerequisite implements every current public
credential-store API with a std/path-only Rust policy core and a self-contained
addon. Rust owns encrypted document validation, backend selection, credential path
plans, Keychain commands/diagnostics and migration/rollback policy. Node supplies
platform AES-256-GCM/scrypt, filesystem and process operations. Existing consumers
remain on `auth-store`. Native/oracle tests verify bidirectional encrypted document
compatibility, Unicode/empty values, random IVs, 0600 permissions, tampering, wrong
machine identities, derivation retry, file/ancestor symlinks, temporary collisions,
write/chmod/rename failures preserving the old credential, inherited fields,
Keychain signal/spawn/stream errors and exact migration calls. In-memory delayed
operations cover serialized mutations, partial rollback, read-only reads and
preventing resurrection after deletion. Focused maintained build/lint/types, four
Rust tests and fifteen native groups pass. The npm dry-run package contains the
native artifact and public declarations with no external runtime dependencies.
Completed key derivations now use an own Rust cache capped at 64 entries with LRU
eviction, while pending derivations remain shared by the host and are removed on
success/failure. Identity keys exceeding 16,384 UTF-16 units bypass caching. Native
tests verify 4,096 churn cycles keep the bound, buffers cannot mutate retained keys,
UTF-16 keys remain distinct, and invalid key sizes do not alter the cache. Six Rust
tests and sixteen native groups plus lint/types pass. This proves cache retention
bounds, not general process leak freedom or a performance advantage.

The credential host adapter and native API now each have one shared source suitable
for embedding directly in own consuming addons. Public `auth-store-rust` APIs load
that adapter with the package's native core; separate binding families interoperate
through encrypted documents. Six Rust tests and seventeen native groups plus
focused lint/types pass. The OAuth port can reuse these sources in its own artifact
without adding a runtime package import or duplicating credential policy.

OAuth session and client-registration persistence now embeds the own credential
API in the OAuth native binary and bundles its single host/type source beside the
addon. Rust validates stored-session fields/dates, projects stored clients, and
hashes resource/issuer keys with the own SHA-256 implementation. Node normalizes
resource URLs and supplies filename assembly/platform I/O. Native/oracle checks
verify encrypted stores interoperate in both directions, URI-specific filename and
Keychain account/service selection, optional/invalid stored fields, Date limits,
malformed JSON SyntaxError diagnostics, infinite expiry, raw issuer surrogate
hashing, client projection and clear/missing paths. Public declarations are checked
from actual built output, including the bundled credential option types. Fourteen
Rust tests and twenty-nine native groups plus maintained build/lint/types pass.
JSON parsing retains the shared core's depth/node/byte limits; metadata beyond those
limits is rejected rather than promising unbounded JSON.parse parity. Default
provider and JWKS verification remain incomplete.

The own Rust default OAuth provider now implements session/token normalization,
issuer/resource binding, endpoint transport policy, cached discovery, client
resolution, dynamic-registration bodies/results, authorization parameters and
separate bounded transient/re-registration retry decisions. A reusable Rust effect
machine requests clocks at the same expiry checks and instructs the host to use,
refresh, clear or authorize sessions. Node executes/coalesces fetch/storage/browser
operations and closes loopback sessions in finally blocks. Registered-client state
is owned natively for each provider; optional own undefined client-secret fields
are preserved at the JS boundary. Tests first reproduced inherited action-field
contamination and loss of cached own undefined fields during retry, then verified
their fixes. Native/oracle checks cover successful/failed refresh, force refresh,
static/dynamic flows, state/issuer/PKCE parameters, concurrent caller coalescing,
distinct retry budgets, abort reader cleanup and fresh attempts after failure.
All 50 original client/persistence contracts execute the Rust public APIs through
a development-only import adapter with a factory-identity assertion; this gate is
part of the maintained unit command. Nineteen Rust tests, thirty-nine native groups,
fifty reference contracts and public type fixtures pass with focused build/lint.
JWKS verification and general native memory/performance auditing remain required.

The Rust JWKS verifier now exposes the original public factory/types. Rust owns
compact protected-header admission, base64 decoding, key filtering/import plans,
claim-validation order, issuer/expiry/not-before/tolerance/type policy, scope
selection and cache TTL/forced-refresh cooldown. Node's built-in WebCrypto supplies
asynchronous signature/import primitives without jose or other npm runtime
dependencies. All ten default algorithms verify official JOSE signatures. Cached
documents use shared immutable Rust snapshots; 4,096 replacements demonstrate
that old documents are released after in-flight snapshots drop. This verifies
that retention property, not general process leak freedom or faster verification.
Failed refreshes share one pending operation, consume cooldown, clear pending
state and permit later attempts; failed documents preserve existing snapshots.
The maintained unit command now runs all 95 original public OAuth/JWKS contracts
against the Rust factories with identity assertions. An additional 296 signed
hostile header/claim/scope cases and 32 configuration cases match the TS oracle.
Twenty-eight Rust tests, fifty-six native groups, public type compatibility,
focused build and lint pass. All currently exported OAuth APIs are implemented;
internal lifecycle conformance and broader memory/performance auditing continue.
Claim admission deliberately uses own JSON entries, so inherited prototype claims
cannot supply a missing issuer/expiry. Shared JSON depth/node/byte limits still
apply to decoded documents. Cross-platform native artifact delivery remains a
separate unfinished validation item.

The OAuth development conformance gate now discovers all fifteen original test
files through maintained source membership and redirects their implementation
imports/mocks to the Rust package. TypeScript AST parsing derives factory/function
identity assertions from each test's named imports; a test without a verified
native import fails instead of silently executing the TS implementation. All
153 original contracts pass, including registration/token/body ownership deadlines,
loopback callbacks, resource normalization, state/PKCE and issuer credential binding.
The independent native tests remain required for real addon execution and host
lifecycle paths outside mocked interaction boundaries.

The new private `mcp-oauth-server-rust` checkpoint implements all public in-memory
store methods and CSRF helpers. Rust owns table retention, single-use takes,
atomic refresh rotation, replay-family/grant revocation and notification record
selection. The Node host uses built-in structuredClone/V8 serialization for opaque
record snapshots, including own undefined fields, cycles, dates, bigint and typed
values; these are host primitives, not TS implementation delegation. Immutable
record payloads are shared across native refresh-history entries, avoiding a copy
of the original serialized record on every rotation. A 4,096-rotation/64 KiB payload
test verifies sharing and release after store drop. The store intentionally retains
replay history for its lifetime like the original; no total-memory bound or general
process leak-freedom claim is made. Family revocation collects affected grant IDs
once rather than rescanning the refresh table for each grant.
Native oracle checks cover 512 mixed replacement/rotation/revocation operations,
expiry/NaN/infinity/same-hash edge cases, clone isolation, 32 concurrent transaction
and code takers, cookie validation/call order and timing-safe UTF-8 CSRF comparison.
An expiry/NaN mismatch was reproduced red before correction. Seven Rust tests,
eight native groups and structural public type compatibility pass; focused build
and lint pass. The actual npm tarball's standalone addon/store/security APIs were
extracted and smoke-checked, then temporary artifacts purged.

The authorization-server factory and every public endpoint/API are now implemented.
Rust owns configuration and URL admission, scoped direct record capture, registration,
authorization/code/refresh/revocation policy, S256 hashing, signing/key plans and
compact JWS/JWT claim admission. Node built-ins supply URL/Request/Response, callback
storage and asynchronous signing/WebCrypto verification. ES256 and RS256 tokens are
verified by the official JOSE development oracle. Body cancellation releases reader
locks/listeners without awaiting stalled underlying cancellation. Real failures for
raw form fragments, Infinity limits, unused getters, non-enumerable record fields
and mutated algorithm/key confusion were reproduced before correction.
Fifteen Rust tests, 23 native groups, all 26 original server/security contracts and
bidirectional public type compatibility pass, alongside focused build and lint.
The signed hostile JWT matrix compares 110 header/claim combinations and their
JOSE error metadata against the original implementation. The standalone tarball
factory/endpoints are smoke-checked separately. The package remains private;
cross-platform delivery and broader memory/performance evidence are unfinished.


The new `tiny-http-mcp-server-rust` foundation implements Rust JSON-RPC batch
classification, sticky byte budgets, modern header/name mirrors, UTF-16 SSE
formatting, bearer parsing/challenges/verifier-error/scope admission and resource
metadata. Node supplies streams, URL and auth callback primitives. Request byte
limits preserve original error precedence even when earlier chunks have invalid
UTF-8. Scoped native verifier-error capture avoids whole-error serialization,
cycles and bigint failures. Classified arrays share admitted object identities;
the native plan retains each payload once rather than copying it into every group.
An ordered Rust session table preserves replacements/live iterator order and
releases both payloads and indexes under 4,096-operation churn. A real failing
GC test demonstrated that strong ObjectRef ownership keeps an unreachable
session/store cycle alive. The corrected design stores Rust index/slot identities
while host objects remain in a JavaScript Map visible to GC; the cycle test passes.
Eleven Rust tests, 16 native groups, 17 original header/UTF-8 contracts and public
structural type checks pass with focused build/lint. The package has no npm runtime
dependencies. This is a foundation checkpoint: HTTP factory/listening, complete
session admission, SSE replay/backpressure, OAuth transport wiring, testing helpers
and Express adapters remain unfinished.


The HTTP factory, listener, transport and Express-compatible adapters are now
implemented against the embedded additive Rust server core. The standalone addon
contains our protocol/schema/server and JWKS cores; its host files import Node
built-ins and local artifacts only. Rust HTTP policy owns host/origin/Accept and
modern mirrors, limits, session/protocol/message admission, status/rejection plans
and projected callback-result observations. Node executes storage/callbacks,
HTTP writes, AbortControllers, async-local request context and timers. Native
configuration capture preserves null/nonfinite rejection without whole-option
serialization. Projected result capture fixes a red cyclic/getter notification
result that previously produced 500 instead of 202, and avoids copying unused
large callback payloads during session bookkeeping. Native replay history evicts
through a bounded deque and shares immutable payload snapshots; 4,096 insertions
verify release after snapshot drop. A non-enumerable external store losing its
metadata still counts retained local handlers for session admission, matching
the original contract. ES/RS/PS/EdDSA JWKS verification embeds the own OAuth core;
32 concurrent official-JOSE-signed token checks coalesce to one fetch.
Sixteen Rust tests, 22 native groups and 133 original contracts across fourteen
transport/security/context/protocol/stream test files pass with focused build,
lint and bidirectional HTTP server/options types. Reference fixtures import the
native family for core/media helpers; factory identity assertions prohibit silently
executing the TS HTTP implementation. The HTTP bridge declarations retain the
original core session/SDK interface so native-only stdio conveniences do not
prevent structural interchangeability. The actual standalone tarball's factory,
modern discovery and legacy session/tool flows are checked separately, including
a live loopback listener/tool/shutdown smoke. Testing
helpers, CLI, broader platform validation/performance and inherited schema/URI
corner cases remain unfinished; this is not completion of the full rewrite goal.

The additive Rust server now compiles/snapshots tool input schemas with the Rust
schema core and rejects invalid arguments before invoking handlers. Legacy and
modern errors match TypeScript issue data and formatting. Disabling argument
rejection is exposed with `validateToolArguments: false`; invalid JSON/object
arguments remain rejected. Failed replacement compilation preserves the original
registration. Output contracts compile at registration, normalize structured
content, enforce successful output schemas, and retain per-invocation snapshots
through replacement/removal. Legacy scalar/array schemas preserve text fallback
and skip output validation; explicit error results bypass schema checks. Tests
cross-check legacy/modern behavior and prove retained contracts survive changes.

The server package now includes an independent Rust RFC 6570 template parser,
expander and matcher, exposed through `parseUriTemplate` in its native Node API.
All 223 positive and 29 negative local RFC fixtures pass, with exact expansion and
capture cross-checks against TypeScript. Additional tests cover UTF-16, invalid
percent sequences, Unicode prefixes and bounded ambiguous matching/expansion.
Resource registration and template dispatch now use a Rust feature registry, with
prompt/resource/template snapshots, duplicate handling, removal and custom methods.
Required prompt arguments, negotiated prompt content, exact-before-template resource
resolution, modern resource cache metadata and feature results are validated in Rust.
Legacy/modern callback errors and resource-not-found codes are cross-checked against
TypeScript. An official SDK client lists/gets prompts and reads exact/template
resources over the existing native stdio engine. Cancellation tests retain global
capacity until a canceled feature callback settles. Legacy resource subscriptions,
session/global notifications, custom request-scoped delivery and stdio notification
output now use independent Rust lifecycle/recipient state and Node callback adapters.
Checks cover disabled capabilities, repeated initialization, cancellation, close,
delivery failures and observer subscription changes before delivery. The official
SDK subscribes/unsubscribes and receives resource/tool notifications over stdio.
This checkpoint passes 56 Rust and 301 native tests plus focused build/lint/types.
An SDK transport adapter now admits decoded messages through Rust without JSON
serialization or an SDK runtime dependency. Official `InMemoryTransport`/Client
checks cover tools, prompts, resources and updates; differential checks cover IDs,
notification admission, ignored responses, startup failure, close, delivery errors
and capacity retained by canceled callbacks. Its public transport types compile
against the actual official SDK class without a consumer cast or type import.
Modern `subscriptions/listen` now uses a native Rust registry with acknowledgment
readiness, supported filters, deduplicated bounded URI sets and lossless request IDs.
Host abort immediately removes a subscription while preserving active capacity for
pending acknowledgment delivery. Events carry subscription metadata, and stdin EOF
ends long-lived listeners. Tests cover lifecycle/filter parity with TypeScript,
acknowledgment/broadcast failures, snapshots and admission bounds, plus real stdio
and official SDK InMemoryTransport delivery. The expanded checkpoint passes
59 Rust and 311 native tests. Complete input-required/retry payloads remain pending.

`toolcraft-schema-rust` now has a private native checkpoint with independent
compilation/evaluation of boolean and type schemas, scalar limits, value equality,
object/array applicators, composition, conditionals, unevaluated members, URI-based
resources/registries, pointers/anchors, dynamic/recursive refs and vocabularies.
Native validation and issue formatting are checked
against TypeScript, including its signed-zero equality behavior. Its graph owns
child schemas once rather than retaining cloned subtrees at every ancestor.
The schema and server bindings share one descriptor-safe ingress source.

This checkpoint runs all 2,226 cases in the locally vendored official draft-7 and
2020-12 suites (640 groups), plus 23 Rust tests and 15 native safety/diagnostic
comparison tests. This does not include optional upstream suites or establish
complete ECMAScript regex compatibility. Schema URI normalization is checked against
Node and TypeScript for special URL references, credentials, IPv4/IPv6 and controls;
full WHATWG and Unicode host compatibility remain pending. The own bounded Unicode
pattern engine supports scalar matching, ranges/classes, repetition, alternation,
lookahead, word boundaries and bundled Unicode 17 general categories. Tests compare
it against TypeScript and exercise bounded failures for pathological patterns.
Backreferences, lookbehind, named groups, Unicode scripts and most binary properties
fail explicitly and remain pending, together with fluent DSL and
non-JSON host values remain pending. Known unfinished constraints fail explicitly
at compilation, and no MCP consumer has been switched to the new schema package.

Custom formats now use an injected per-evaluation Rust validator interface, with
an environment-local synchronous napi callback. The host snapshots own enumerable
format functions without evaluating getters. Conformance tests cover strict true
results, references/property names, inherited registrations, callback exceptions,
reentrant validation, and isolated worker environments. Diagnostics preserve full
UTF-16 pattern/format names in expected/message/keyword fields.

The active goal began on 2026-09-20 at 02:45 UTC (September 19 at 21:45 Chicago).
The user's minimum effort requirement is 24 hours, with a deadline of Monday,
September 21 at 12:00 America/Chicago (17:00 UTC). Neither the duration nor the
full objective has been achieved yet. Continue implementation and independent
compatibility, memory, stability, and performance review through that requirement;
report actual elapsed work and remaining gaps rather than treating elapsed time
alone as completion.

## Objective and boundary

Create independent Rust implementations of the MCP libraries with TypeScript
bindings through `napi-rs`. Use the existing package name plus `-rust`; retain
the scope for scoped packages. Existing TypeScript packages, imports, binaries,
and production consumers continue to use their current implementations.

This round is additive. Add Rust counterparts and the supporting Rust rewrites
they need, including `toolcraft-design-rust` when a concrete native consumer needs
design-system behavior. Do not delete, rename, replace, or retire existing
implementations; change production import paths; switch default backends; or
publish replacements. Build/test registration may add the entries needed to
exercise the new packages while retaining all existing routes and behaviors.

Keep the Rust libraries usable from other projects without depending on the
poe-code CLI or a running Node process. Separate Node bindings from the Rust core
so Python bindings can later use PyO3 and maturin against the same implementation.
Python bindings are an architectural consideration, not additional implementation
scope for the first MCP work.

### Expanded poe-agent scope

The user subsequently required the rewrite to include everything needed for
`poe-agent`, and authorized committing each completed package and pushing directly
to `main` without waiting for CI. Production consumers remain unchanged and Rust
packages remain private. Package commits, verified remote delivery, and any release
status are reported separately; publishing or enabling the Rust replacements is
still outside this round.

The declared runtime dependency closure of `@poe-code/poe-agent` contains nineteen
workspace packages, including the agent itself. Each requires a suffixed Rust
counterpart for the behavior actually needed by the independent agent:

| Existing package                | Rust counterpart                     |
| ------------------------------- | ------------------------------------ |
| `@poe-code/poe-agent`           | `@poe-code/poe-agent-rust`           |
| `@poe-code/agent-spawn`         | `@poe-code/agent-spawn-rust`         |
| `@poe-code/poe-acp-client`      | `@poe-code/poe-acp-client-rust`      |
| `@poe-code/user-error`          | `@poe-code/user-error-rust`          |
| `auth-store`                    | `auth-store-rust`                    |
| `tiny-mcp-client`               | `tiny-mcp-client-rust`               |
| `@poe-code/agent-defs`          | `@poe-code/agent-defs-rust`          |
| `@poe-code/agent-harness-tools` | `@poe-code/agent-harness-tools-rust` |
| `@poe-code/agent-hook-config`   | `@poe-code/agent-hook-config-rust`   |
| `@poe-code/agent-skill-config`  | `@poe-code/agent-skill-config-rust`  |
| `@poe-code/poe-code-config`     | `@poe-code/poe-code-config-rust`     |
| `@poe-code/process-runner`      | `@poe-code/process-runner-rust`      |
| `toolcraft-design`              | `toolcraft-design-rust`              |
| `@poe-code/config-extends`      | `@poe-code/config-extends-rust`      |
| `@poe-code/config-mutations`    | `@poe-code/config-mutations-rust`    |
| `@poe-code/frontmatter`         | `@poe-code/frontmatter-rust`         |
| `@poe-code/providers`           | `@poe-code/providers-rust`           |
| `@poe-code/task-list`           | `@poe-code/task-list-rust`           |
| `toolcraft-schema`              | `toolcraft-schema-rust`              |

This closure adds about 82,700 non-test TypeScript source lines by a first manifest
inventory; source imports and optional paths still require review. Counts do not
prove behavioral coverage. External packages currently supply OpenAI API/SSE
handling, glob/ignore/shell parsing, HTML-to-Markdown conversion, YAML/TOML/JSONC,
TypeScript config evaluation, and terminal width/wrapping. The native rewrite must
provide those required behaviors without retaining the external runtime packages.
Standard host HTTP, crypto, filesystem, and process adapters remain allowed.

Acceptance includes the fluent agent builder, plugin registry and hooks, providers,
streaming model protocols, MCP tools, files/shell/web/memory/skills/policy/compaction,
child spawning, ACP, session branching and persistence, cancellation, background
process cleanup, and transcript events. Exercise all of these with deterministic
model/host adapters; no test calls a live model. Port the dependency graph in order
and use the existing public APIs and tests as development-time references. A
small native orchestration shell delegating agent logic back to TypeScript is not
an independent Rust rewrite.

## Dependency policy

The shipped packages are self-contained, with zero external runtime package
dependencies. Development dependencies may provide tooling and cross-checking;
official MCP SDKs are test oracles, not the implementation. In particular, do not
use `rmcp` as the Rust engine, bundle it to disguise a runtime dependency, or
delegate protocol operations to an official SDK.

Implement the MCP protocol, client/server lifecycle, and state in our own Rust
libraries. Keep the core standard-library-only as the starting constraint; this
investigation does not authorize additional implementation crates. The previously
selected `napi-rs` binding necessarily uses Rust crates and their compiled support
code. Those are explicit binding/build dependencies, not proof of a literally
dependency-free native binary. Python bindings would have the analogous PyO3
exception when implemented.

For npm artifacts, runtime `dependencies`, `optionalDependencies`, required peers,
and bundled external implementation packages are empty. Ship the supported native
binaries and generated loader in the package itself, rather than using platform
packages as optional dependencies or downloading binaries during installation.
Installed consumers need their normal host runtime, not Rust, Cargo, a compiler,
the napi CLI, or a running service. Future Python wheels likewise ship their
extension and need no external Python runtime packages.

Use host-standard networking and cryptographic capabilities behind explicit
adapters where needed. Do not write new cryptographic primitives to satisfy the
dependency goal. General JSON Schema validation and JSON/TOML/YAML parsing are
substantial implementation work under this constraint; existing parser/validator
packages cannot simply become runtime dependencies. Python's standard library
also does not provide a general JWT signing/verification implementation. Native
and Python feature parity must account for these gaps explicitly, rather than
silently adding a library or omitting a feature.

## Repository inventory

There are ten MCP-named package directories. Their `src` trees contain roughly
22,200 TypeScript lines, including exported testing support, and 136 test or
compile-check files. These figures describe scope, not an effort estimate.

| Existing package directory        | Rust counterpart                       | Responsibility and dependencies                                                                                                                                               |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tiny-stdio-mcp-server`           | `tiny-stdio-mcp-server-rust`           | Shared server engine, stdio, schemas, content helpers, resources, prompts, custom methods, subscriptions, cancellation, and testing helpers. Uses `toolcraft-schema`.         |
| `tiny-http-mcp-server`            | `tiny-http-mcp-server-rust`            | HTTP transport around the shared server engine; SSE, replay, sessions, authorization, limits, observability, Node HTTP and Express adapters.                                  |
| `tiny-mcp-client`                 | `tiny-mcp-client-rust`                 | Client lifecycle, JSON-RPC, stdio and HTTP transports, subscriptions, sampling, elicitation, roots, OAuth discovery, and test pairs.                                          |
| `mcp-oauth`                       | `mcp-oauth-rust`                       | Client authorization, PKCE, loopback flow, token refresh, metadata handling, resource indicators, session storage, and JWKS verification.                                     |
| `mcp-oauth-server`                | `mcp-oauth-server-rust`                | Authorization server, signing, grants, one-use codes, refresh-token rotation, revocation, interaction security, and storage contracts.                                        |
| `agent-mcp-config`                | `agent-mcp-config-rust`                | Agent configuration shapes and parsed JSON/TOML/YAML mutations; depends on agent definitions and config-mutation infrastructure. This is configuration, not a wire transport. |
| `tiny-stdio-mcp-test-server`      | `tiny-stdio-mcp-test-server-rust`      | Deterministic stdio fixture and tool-call recording.                                                                                                                          |
| `tiny-http-mcp-oauth-test-server` | `tiny-http-mcp-oauth-test-server-rust` | Combined MCP/OAuth fixture; also depends on `tiny-oauth-test-server`, which is not itself MCP-named.                                                                          |
| `terminal-png-mcp`                | `terminal-png-mcp-rust`                | Application server for terminal PNG rendering; implementation currently delegates to `terminal-png`.                                                                          |
| `terminal-pilot-mcp`              | `terminal-pilot-mcp-rust`              | Application server built from Toolcraft commands and `terminal-pilot`; actual work includes PTYs, terminal state, processes, and rendering.                                   |

MCP also appears inside other packages. `toolcraft` has server and proxy adapters;
`memory` and `superintendent` expose application servers; `poe-agent` and `safe-js`
consume the client. Other adapters, including `agent-code-review`, require separate
application-level assessment. They are recorded as integration surfaces and remain
unchanged during the independent library work. An inventory of MCP-named packages
is not a claim that every MCP-related application in the repository has been ported.

The two terminal application servers are small wrappers, not small self-contained
Rust rewrites. A binding that delegates their work to the existing TypeScript
implementation does not constitute a native Rust version. Track the rendering and
terminal-runtime prerequisites explicitly before claiming those ports complete.

## Supporting design-system rewrite

The core stdio and HTTP MCP packages inspected here do not import the design
system directly. `terminal-pilot-mcp` builds commands through `toolcraft` and runs
them through `toolcraft/mcp`; Toolcraft's CLI and MCP proxy use `toolcraft-design`.
That creates an application/presentation dependency, not a reason to couple the
Rust wire-protocol engine to terminal UI.

`toolcraft-design` includes tokens/themes, ANSI styling, Unicode-aware layout,
help and tables, Markdown, prompts, dashboards, explorers, and terminal screen
handling. Its current runtime dependencies include `fast-string-width`,
`fast-wrap-ansi`, `sisteransi`, and the frontmatter package. A zero-dependency Rust
counterpart needs its own behavior for the features it exports; importing the
existing TypeScript design package or its dependencies at runtime is not a port.

Add `packages/toolcraft-design-rust` if needed, with the same separation between
the Rust library and its Node binding as the MCP packages. Port the required
capabilities in dependency order:

1. Tokens, themes, terminal-text escaping, ANSI styling and control sequences.
2. Display width, ANSI-aware wrapping, columns, help, static tables/cards, and
   deterministic renderers required by native consumers.
3. Markdown and template rendering when used by those consumers.
4. Prompts, spinners, screen state, dashboards, and explorers when a native
   interactive application actually needs them.

Preserve current appearance and public behavior. Use existing TypeScript output
as a development-time reference. Test narrow widths, ANSI resets, terminal-text
escaping, combining marks, wide characters, emoji, color-disabled output,
non-interactive output, input cancellation, and restoration after shutdown.
Keep theme/output settings scoped to each binding environment; the reusable
Rust core must not acquire process-global JS state.

Expose implemented features precisely. A partial static-rendering port is not
full dashboard/prompt parity. Add ad hoc screenshots of native demo output for
visual changes; do not add screenshot tests or switch the production CLI to
exercise the new design package. Generate design documentation when an actual
visual-language change warrants it, preserving existing generation routes.

Own supporting Rust libraries such as schema, configuration, terminal rendering,
frontmatter, or PTY counterparts are in scope when needed by a port. Give them
the `-rust` suffix and the same additive and dependency rules. Design-system
work does not by itself replace `terminal-png`'s SVG/PNG/font backend or
`terminal-pilot`'s terminal/PTY runtime; assess those implementations separately.

## Architecture

For each substantive library, put the reusable Rust core and its Node binding
in separate Cargo packages. A possible npm workspace layout is:

```text
packages/tiny-mcp-client-rust/
  package.json
  README.md
  Cargo.toml                 # reusable Rust library
  src/                       # Rust implementation
  bindings/node/
    Cargo.toml               # cdylib, napi + napi-derive
    build.rs
    src/
  node/                      # TypeScript host adapters and public API
  dist/                      # generated loader, declarations, native artifact
```

Preserve the dependency direction: HTTP uses the server core; fixtures use the
real client/server/OAuth cores. Share protocol models and implementation utilities
where they have actual consumers; avoid a new generic framework or a binding crate
that also owns application logic.

Keep the core independent of `napi`, PyO3, JavaScript values, Python objects,
terminal presentation, and poe-code-specific configuration. Rust callers use Rust
types directly. Node callers use the generated native exports and a small adapter
that implements JavaScript-specific behavior. Public generic schema inference can
remain in TypeScript; generated declarations alone do not reproduce that API.

Each addon owns the Rust objects it exposes. Do not exchange opaque class instances
between independently built `.node` modules without a deliberately designed ownership
contract. Reuse Rust crates at compile time; share ordinary descriptors at a binding
boundary. HTTP can own its complete server dependency graph inside its addon.

Python would add a separate `bindings/python` crate using PyO3, built into wheels
with maturin. Both bindings call the same Rust core; the Python package does not
route through Node. Async Python support needs an explicit asyncio/Rust-runtime
adapter, and eligible Rust computation should release the GIL.

## Upstream and toolchain findings

The official Rust MCP SDK, `rmcp`, is a useful conformance reference, not an
implementation dependency under the zero-dependency requirement. Its upstream
README and model source explicitly include `2026-07-28` as well as earlier
versions. Its client supports initialize, discovery, and automatic fallback
lifecycles. Use it and the official TypeScript SDK for development-time
cross-checking while retaining our own implementation.

Registry metadata at investigation time reports `rmcp` 3.4.0, `napi` 3.12.6,
`napi-derive` 3.6.7, and `napi-build` 2.4.3, with Rust 1.88 as their minimum
reported Rust version. `@napi-rs/cli` reports version 3.10.4 and requires Node
`^20.17.0 || ^22.13.0 || >=23.5.0` to run its tooling. Compiler/tooling requirements
are distinct from the Node versions supported by the finished addon.

The inspected machine has Rust 1.98.1 and Node 22.23.2. No toolchain installation
is needed to begin a local prototype. Inspection of the published `rmcp` 3.4.0
crate archive confirms the same protocol-version constants and the required
transport feature declarations. Actual lifecycle and behavior parity still need
contract tests; exported constants and upstream documentation do not prove it.
These findings characterize a possible test oracle, not permission to link it
into the shipped implementation.

## Compatibility work

- Preserve both legacy lifecycle and the repository's `2026-07-28` discovery,
  request metadata, cache metadata, input-required responses, subscriptions,
  parameter headers, and output-schema behavior. Merely supporting tool calls
  is not package parity.
- Test JSON-RPC string and numeric IDs, notification semantics, error codes and
  data, malformed messages, and result metadata. Arbitrary extension metadata
  should survive conversion.
- Match schema compilation timing, nullability normalization, structured results,
  and validation issues. Current server code uses `toolcraft-schema`'s
  `compileJsonSchema` and `formatIssues`; its README's Ajv descriptions are not
  the authority for current error behavior. A Rust validator needs contract tests
  rather than an assumption of identical diagnostics.
- JS tool, resource, prompt, sampling, roots, elicitation, storage, and verifier
  callbacks may return promises. Invoke them on the owning JS thread through
  appropriate thread-safe binding mechanisms; propagate exceptions as operation
  errors. Never synchronously wait on the JS thread or hold a core lock while
  calling into application code.
- Translate `AbortSignal` into native cancellation with deterministic listener
  cleanup and request settlement. Async execution alone does not provide this.
- Custom `fetch`, `spawn`, streams, transports, `Request`/`Response`, `URL`,
  `KeyObject`, `Date`, and Node HTTP objects require host adapters. They are not
  automatically equivalent to a Rust struct with similar fields.
- Preserve the Node HTTP/Express path as an adapter over native protocol/session
  logic. A native TCP listener cannot manufacture a real Node `IncomingMessage`
  or `ServerResponse`; expose a native listener separately and document its context
  differences instead of pretending it is interchangeable with that adapter.
- Match SSE framing across chunk boundaries, UTF-8 rejection, byte limits, reconnect
  cursors, response-body ownership, session deletion, redirects, and auth headers.
- OAuth ports need storage atomicity, token replay behavior, issuer/audience/resource
  checks, algorithm restrictions, JWKS limits, and cancellation tests. Use existing
  tests as evidence of contracts rather than replacing security behavior with a
  generic token library's defaults.
- Configuration ports parse documents and deep merge them. Preserve unrelated keys,
  dry-run behavior, observers, and injectable filesystem support. Agent metadata
  stays declarative and derives from maintained definitions instead of becoming a
  second hand-maintained registry in Rust.

## Performance, memory, and stability

A stdio checkpoint on Node 22.23.2 used separate processes, release addons,
in-memory Node streams, one sequential legacy request at a time, 1,000 warmups,
and five batches of 20,000 requests. The same host loop serialized requests,
parsed responses, and checked successful echo text in both implementations.
The tool schema was only `{ type: "object" }`; this is not a schema-enforcement
benchmark or proof of full behavioral parity.

| Workload | TypeScript median | Rust median | TypeScript RSS after GC | Rust RSS after GC |
| --- | --- | --- | --- | --- |
| Ping | 6.09 µs | 6.06 µs | 89.50 MiB | 82.23 MiB |
| JavaScript echo, initial wire path | 8.30 µs | 15.75 µs | 87.50 MiB | 102.95 MiB |
| JavaScript echo, lazy primitive copying | 8.30 µs (same reference run) | 13.04 µs | 87.50 MiB | 103.56 MiB |

Primitive copying now avoids looking up object descriptors/prototypes for scalar
values, with a failing-then-passing native regression test. The rerun is consistent
with less conversion overhead, but does not establish a durable speedup by itself.
Rust remains slower for this callback workload. Echo retained heap after GC was
about 369 KiB for TypeScript and 301 KiB for the optimized Rust run. Endpoint RSS
is neither peak memory nor leak evidence, and it did not improve for Rust echo.
These results supersede any general inference of lower memory from the first
in-memory callback measurement below. Investigate meaningful batching and fewer
native crossings after completing protocol/schema parity.

Native bindings remove the extra process and JSON-over-stdio boundary between the
SDK and engine. MCP's own network or stdio transport remains, of course. Core state,
framing, validation, scheduling, and native transports stay in Rust. Transfer complete
operations or meaningful events, not every internal step; avoid repeated stringify/parse
and full-history conversion. JSON-like values still need conversion at language boundaries.

Rust can improve CPU time and allocation behavior, especially compared with Python
loops over many objects. It does not reduce model response times or make external
tools execute faster. TypeScript and Python execute the same native core; differences
come from adapters, conversions, callbacks, and their host runtimes. No speedup claim
is established by this investigation.

Lower memory is possible, not automatic. The Node or Python runtime remains loaded.
Keep one authoritative copy of state, bound queues and retained histories, and release
native resources explicitly. Use buffers where their ownership model actually avoids
copies. Native buffers and allocations may not be reflected accurately by host heap
metrics, so measure process RSS and native allocations as well as language heap use.

Safe Rust prevents many memory-safety and data-race errors. Binding libraries still
contain unsafe boundaries, and a fatal native failure can terminate the host process.
Exercise callback lifetimes, reentrancy, concurrent close/cancel, worker environments,
and shutdown. Never store environment-specific JS handles in process-global core
state. Deterministic close/dispose is the primary cleanup mechanism; finalization is
a fallback. Python adds reference/GIL and interpreter-lifetime considerations.

Benchmarks compare equal behavior using deterministic workloads: JSON-RPC parsing,
schema validation, in-memory dispatch, concurrent requests, notifications, large
content, sustained session churn, and cancellation/cleanup. Measure throughput,
latency distribution, event-loop responsiveness, peak and steady RSS, and retained
memory after close. Separate callback-heavy cases from native tool cases. Repeated
sessions should plateau in retained memory. Real model calls cannot isolate engine
performance and are not benchmark or unit-test dependencies.

The first callback-heavy checkpoint measurement used separate Node 22.23.2
processes, release addons, 1,000 warmup calls, five batches of 20,000 legacy echo
calls, and explicit GC before and after. Median time per call was 5.14 µs for
TypeScript and 15.09 µs for Rust. Final RSS was 83.31 MiB and 65.72 MiB,
respectively; retained JS heap changes were about 132 and 135 KiB. This synthetic
measurement establishes a regression to address, not a general speed or memory
guarantee. Prioritize parsing wire messages once in Rust, reducing boundary
crossings, and measuring equivalent schema-heavy and native-tool workloads before
choosing production defaults. Repeat memory measurements over sustained session
churn and cancellation; a single RSS endpoint does not establish leak freedom.

## Implementation sequence and acceptance

1. Establish the package/Cargo layout and independent build path. Pin binding/tooling
   dependencies and write failing contract tests using the existing implementation
   and official SDKs as development-only oracles. Implement our own protocol core.
   First deliverable: an actual native server addon with an async JavaScript
   echo tool, in-memory transport, cancellation, and deterministic disposal.
2. Complete `tiny-stdio-mcp-server-rust` and its stdio fixture. Cover legacy and modern
   protocol, schemas, content, resources, prompts, and subscriptions.
3. Implement `tiny-mcp-client-rust` lifecycle, in-memory/stdio/HTTP transports and
   server-to-client callbacks. Treat OAuth support as incomplete until the OAuth port
   is connected inside the Rust package family.
4. Implement `tiny-http-mcp-server-rust` using the shared native server core, including
   HTTP/SSE lifecycle, sessions, limits, and separate Node/Express adapters.
5. Implement both OAuth packages and the combined HTTP/OAuth fixture. Complete client
   OAuth parity and test both native and application-supplied storage paths.
6. Implement `@poe-code/agent-mcp-config-rust` against explicit mutation/filesystem and
   registry contracts; do not silently expand into a rewrite of all configuration
   and provider packages.
7. Add the supporting Rust counterparts needed by terminal applications, including
   the required `toolcraft-design-rust` capabilities, and implement the terminal
   application ports against their real native prerequisites. Record any remaining
   embedded MCP application ports separately.

Use TDD for code: first a failing behavior test, then the native implementation.
Pure Rust tests use in-memory state and injected I/O/clock dependencies. Node file
mutation tests use memfs; neither suite creates real files for unit fixtures. Verify
the actual addon, async callbacks, errors, cancellation, and worker lifetimes rather
than testing only a mock binding. Cross-test old client/new server and new client/old
server, plus the official SDK, without changing production imports.

Give each new npm package maintained `build` and `test:unit` scripts so the declared
workspace routes discover its Rust and binding checks. Focused builds use the existing
`build:workspaces -- --workspace=<exact-name>` route. Cargo dependency relationships
must also be reflected in maintained npm build closure where necessary. Future
workflow changes use `npm run lint:workflows`, not workflow unit tests.

Keep packages private during development. Build and test real native artifacts before
designing publication. Later distribution needs explicit OS/architecture/libc coverage,
native loading errors, tarball checks, generated declarations, and a supported Node
baseline. Existing MCP releases build on Ubuntu and do not establish a Rust addon
release matrix. Rust binaries stay external to JavaScript bundlers; existing SafeFS
native packaging is specialized and is not automatic support for arbitrary addons.
Check packed manifests and installed artifacts for the zero-dependency contract,
including installation with optional dependencies omitted and install scripts disabled.

No production integration or publication is part of the independent-port milestone.
Completion means behavior and native artifacts are verified, not that directories
with `-rust` names exist. Python wheels can be a later milestone using the proven core.

The additive client now exposes own Bearer challenge parsing. Rust scans UTF-16
authentication schemes, token68 credentials, quoted escapes and comma boundaries;
Node's string lowercase primitive normalizes parameter names into a null-prototype
record. This preserves contextual Unicode casing and lone surrogates without adding
a Unicode dependency. A deterministic malformed corpus plus mixed-scheme cases
compares 4,816 headers with the original implementation. Package checks pass 23 Rust
tests and 54 native groups, with bidirectional challenge types and focused build/lint.
HTTP transport and discovery remain incomplete; this is a parsing delivery only.

The client now implements protected-resource and authorization-server OAuth
discovery with native secure URL rules, metadata checks, exact issuer binding,
standard metadata path plans and cache identities. Node supplies WHATWG parsing,
fetch/AbortSignal/body primitives and structured clones. Scoped native capture
ignores unrelated cyclic/bigint fields while preserving valid sparse cached arrays.
UTF-16 diagnostic plans preserve lone surrogates; hostile records reproduced a
lossy diagnostic and stale default fetch reference before their correction.
The artifact embeds the maintained own OAuth/credential modules and their Rust
cores with no external npm runtime dependencies. One converter is shared by the
embedded binding modules rather than compiled twice. Package checks pass 27 Rust
tests, 62 native groups, 42 original discovery contracts in five files, bidirectional
lookup/fetch/result types and focused build/lint. Differential cases include 162
URL combinations and 146 hostile metadata scenarios. Cache-index replacement
churn covers 4,096 updates; an actual addon GC child verifies 64 old snapshots are
released on replacement and the final snapshot on owner drop. Unique-resource
history remains unbounded, matching the original; no total memory bound is claimed.
The standalone packed addon validates discovery/cache isolation, challenges and
embedded PKCE without workspace resolution. Its temporary tarball/extraction was
purged. HTTP transport/controller/SSE/OAuth lifecycle remains unfinished.

A local warmed challenge microbenchmark on Node 22.23.2/darwin/arm64 uses seven
alternating 10,000-call samples. Native median is 611 ns versus 339 ns for the TS
reference on a 48-unit header, and 777 ns versus 726 ns on a 102-unit mixed header.
This path does not establish a speed win; native marshalling has a visible cost
on small inputs. Broader sustained and end-to-end performance work remains required.

The additive client now implements HTTP transport against own OAuth support.
Rust owns modern request slots/cancellation lookup, legacy session identity,
GET stream/reconnect state, disposal plans, standard/parameter header mutations,
exact media type admission and correlated HTTP protocol-error/fallback replies.
Node supplies PassThrough streams, fetch, controllers, body readers, timers and
OAuth/storage callbacks. Modern controllers survive fetch headers through body
consumption; late responses are cancelled, sibling requests remain usable and
all reader locks/listeners are released. Legacy disposal performs at most one
DELETE with a one-second deadline; OAuth retries once and cancels both tee branches.
Request plans and response validators share immutable Arc payloads rather than
deep-copying tool arguments. A snapshot test proves lifetime through plan drop and
release after validator drop. Native request replacement/settlement churn covers
4,096 ID pairs without retained bookkeeping. Scoped header schema projection fixes
a reproduced rejection of valid cyclic/bigint/toJSON extensions without invoking
serialization hooks. It preserves inherited types and date/boolean schema behavior.
The client directly interoperates with original and own HTTP server artifacts in
both legacy and modern modes, including Unicode parameter headers and DELETE/GET
counts. Broader source contracts now cover 289 cases across 35 files, including
the original combined OAuth fixture. Identity assertions require actual native
client bindings; original servers/official SDKs remain development oracles only.
Eight source files for SDK fixture helpers/private utilities/source-only loading
remain outside this redirected suite and are tracked for further validation.
The package passes 32 Rust tests, 65 native groups, public HTTP options/transport
types and focused lint. Native declarations are checked from the shipped dist
artifact so embedded OAuth type references cannot silently become unresolved any.
Focused build checks pass. The actual standalone tarball passes eight live loopback
combinations: original/native HTTP servers, legacy/modern protocols and JSON/SSE
responses, with native tool annotation/header handling and listener cleanup.
Its embedded default OAuth provider separately completes browser/manual callback,
PKCE validation, token exchange, retry and stored bearer reuse. Packed manifests
have no dependencies, peer dependencies or optional dependencies. Temporary
tarball/extraction artifacts were purged after evidence collection.
This is still an additive private port; full MCP/poe-agent and broad performance/
platform acceptance remain incomplete.

The HTTP server now exposes `./testing` with its own in-memory token verifier.
Rust owns UTF-16 token identifiers, automatic ID sequencing, duplicate admission,
dense snapshot slots and issuer/audience/expiry/scope policy. Node retains the
claims snapshots visibly to GC and supplies structured cloning and the clock.
The helper intentionally accepts any matching requested scope like the original
test helper; production bearer admission retains its all-required-scopes rule.
Original comparisons cover rejection ordering, clock calls, exact/fractional and
non-finite expiry, empty/NUL/lone-surrogate identifiers, overridden standard claims,
cycles/bigint/date/map/set and uncloneable claims. A failing accessor case reproduced
partial issuance after a claims getter threw; preparing the ID before host capture
and committing metadata afterward fixes it and preserves failed automatic ID
consumption. Dense indexes remain consistent through 4,096 distinct tokens.
An actual addon GC child verifies owner/claims cycles release after helper drop.
Package checks pass 20 Rust tests, 29 native groups and the existing 133 original
HTTP contracts, plus bidirectional shipped testing declarations and focused
lint/build closure. The standalone packed helper also verifies isolated claims,
native error identity and zero npm runtime dependencies; temporary extraction and
tarball are purged. The token store remains unbounded like the original helper.
HTTP fixture/client-pair testing exports and CLI remain unfinished.

The HTTP server also exposes own `./test-support` fixtures, explicit in-memory
HTTP installation and `nodeFetch`, reexported by `./testing`. No imports patch
globals, including test environments. Rust supplies fixture UTF-16 reversal;
own native server dispatch/schema/media provide the fixture protocol behavior.
Node supplies the HTTP prototype/stream surface. The memory bridge preserves
streaming rather than retaining a duplicate response chunk list. Cancellation,
pre-header/post-header abort and forced connection closure release response slots
and signal listeners. Request objects/overrides, binary/stream/form bodies, multiple
Set-Cookie values, IPv6 and bodyless status codes have direct native-artifact checks.
A GC child reuses an open listener for 128 stream cancellations and confirms all
response cycles release. The original TS client compares all 14 fixture tools in
four protocol/JSON/SSE combinations with original fixtures. Shipped helpers import
only local files and Node built-ins; clients/SDKs are development oracles only.
The original contract suite's setup now explicitly installs the own memory bridge,
and identity gates require native token helpers in OAuth and regression cases.
Checks pass 21 Rust tests, 37 native groups and 142 original contracts in 16 files,
public fixture/fetch declarations, focused lint and maintained build closure.
Actual packed support additionally interoperates with the own native client in
all four protocol/response combinations, alongside token isolation and zero npm
runtime dependency checks. Packed temporary artifacts are purged. Client-pair
exports and CLI remain in progress.

## Sources

- Repository: `packages/tiny-stdio-mcp-server/src/server.ts`, `src/protocol.ts`, and
  `src/index.ts`; `packages/tiny-mcp-client/src/internal.ts`, `src/index.ts`, and
  `scripts/build.mjs`; `packages/tiny-http-mcp-server/src/http-server.ts`,
  `src/http-transport.ts`, and `src/express-middleware.ts`.
- Repository: the ten package manifests and tests; `packages/mcp-oauth-server/src/index.ts`;
  `packages/agent-mcp-config/src/apply.ts`; terminal MCP entry points;
  `packages/toolcraft-design/package.json`, `src/index.ts`, and its rendering modules;
  `scripts/build-workspaces.mjs`; MCP release workflows;
  `docs/development/NPM_PUBLISHING.md`.
- [Official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk), including
  its README, `crates/rmcp/src/model.rs`, and Cargo manifest.
- [napi-rs async functions](https://napi.rs/docs/concepts/async-fn),
  [thread-safe functions](https://napi.rs/docs/concepts/threadsafe-function), and
  [build tooling](https://napi.rs/docs/cli/build).
- Registry metadata from crates.io for `rmcp`, `napi`, `napi-derive`, and `napi-build`,
  and npm metadata for `@napi-rs/cli`. Version observations are date-specific.
