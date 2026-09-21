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

HTTP testing pairs now include a standalone embedded native client, HTTP transport,
OAuth/credential host modules and own Rust path dependencies. No external npm
package is loaded by `createHttpTestPairWithTinyClient`; it returns the client,
transport, listener, request log and cleanup. Setup failure preserves the original
error while closing both resources. Cleanup settles both operations even when
one fails and works on repeated calls. The explicit `createHttpTestPair` SDK oracle
loads the official development SDK only when invoked; it reports a missing SDK
before opening any listener. SDK imports/types are confined to this testing API,
and no runtime/peer/optional npm dependencies are declared. Tests mock both SDK
and original client absence and still execute the standalone native pair.
The combined addon reproduced clippy errors from compiling shared JSON ingress
and egress source modules twice. The new binding-only `mcp-protocol-rust-napi-core`
path crate provides one canonical NativeJson/JSON ingress implementation. Protocol,
stdio, OAuth and client packages each adopt it in separate verified main commits;
their pure Rust cores retain their std/own-path dependency contracts. Stdio's
existing transitive napi versions remain unchanged. Focused maintained tests/lint
pass for all affected packages, plus the client build closure covering the family.
The HTTP package passes 21 Rust tests, 41 native groups, 144 original contracts in
17 files and two own missing-development-oracle contracts. Public SDK/native pair,
request log and factory declarations are checked bidirectionally against originals.
Packed native pairs pass four protocol/JSON/SSE combinations with all external
npm module resolution disabled. Calling the SDK oracle in that environment gives
the explicit required-devDependency diagnostic. Packed token/fixture/own-client
smokes also pass, and temporary tarball/extraction artifacts are purged. CLI,
broader performance/platform acceptance and the rest of the full rewrite remain.

The expanded agent closure now includes private `@poe-code/user-error-rust`.
Its pure standard-library Rust core owns recovery messages/hints and typed boxed
source chains, implements Error/Display/Send/Sync, and releases source owners.
Native bindings expose the shared error taxonomy once; the Node Error adapter
preserves original message/hint/cause descriptors, getter evaluation order, stack
behavior, foreign-bundle recognition and same-realm guard behavior. Arbitrary
causes stay in Node's heap rather than being copied into a native JSON snapshot.
Construction and classification have no per-call native transition. Three Rust
tests cover source chains, concrete type recognition, worker-safe bounds and
4,096 source drops. Four actual-addon groups compare Node behavior with originals
and verify cyclic causes are collectible. All seven original contracts execute
the own adapter under identity gates; bidirectional shipped constructor/error/
guard types and focused lint/build closure pass. The actual packed artifact passes
Unicode/lone-surrogate/NUL messages, cyclic/bigint causes and foreign error guards
with all external npm resolution disabled. Its manifest has no runtime/peer/
optional npm dependencies. Temporary pack/extraction artifacts are purged. This
is an additional closure package, not completion of poe-agent; no speed or lower
standalone memory claim is made for the Node adapter.

The HTTP CLI is now implemented with a standalone suffix-named bin and public
`./cli` API. Rust owns numeric option definitions, validation/error ordering,
OAuth scope configuration, verifier module classification, help text and the
shutdown state machine. Node supplies argument/URL/import/signal primitives.
All 18 numeric flags compare with original behavior across valid decimals,
Unicode whitespace, rounding/overflow and malformed inputs. Original CLI,
verifier loading, invocation path and main HTTP suites run against the addon;
only the advertised command-name assertion changes to the suffix name.
Default shutdown removes signal/timer hooks on success, rejection, deadline,
second signal and stdout failure, including synchronous injected callbacks.
Throwing forced cleanup settles once. Maintained checks pass: 25 Rust tests,
48 native groups, 443 Vitest contracts across 21 files, shipped types and lint.
The maintained 13-package build closure passes. Help and invalid-port screenshots
were visually inspected. Packing reproduced a missing executable mode; the
existing repository prepack hook fixes it. The extracted standalone package
passes executable mode, help/version/error, real HTTP initialize and SIGTERM
shutdown with external npm resolution blocked. Evidence is under
`out/rust-http-cli-*`; temporary tarball/extraction artifacts are purged.
This is package delivery, not completion of the broader rewrite or platform,
memory/stability/performance acceptance.

The private `tiny-stdio-mcp-test-server-rust` now embeds the own native stdio
server rather than importing a runtime npm package. Its Rust core owns lossless
UTF-16 Caesar encryption, finite f64 integer wrapping, tool/schema descriptions,
safe-decimal spawn counting and CLI grammar/help/errors. The three Node factories
preserve the original MCP fixture identity, schema, optional shift and text-only
results. Node built-ins supply streams, fixture recording and startup file/gate
operations. Startup counters and PID writes precede delay/gate waiting; unknown
tools fail before any startup operation. Filesystem behavior is checked with
memfs, with no unit-test files created. Rust/native red evidence precedes the
implementation. The expanded Commander development oracle reproduced missing
inherited-option suggestions, implicit-help ordering and bundled version flags;
each parser discrepancy was corrected before acceptance. The parser oracle now
executes in process rather than spawning every case, reducing its test duration
from roughly 2 seconds to milliseconds. Original CLI contracts still execute the
actual suffix bin; separate native subprocesses verify both fixtures through EOF.
Checks pass: four Rust tests, five native groups, all 23 original contracts plus
five startup contracts, bidirectional shipped factory/server types and lint.
The maintained seven-workspace build closure passes. Help/error screenshots were
inspected. Extracted executable, factory, UTF-16 and real stdio protocol smokes
pass with external npm module resolution blocked; pack/extraction artifacts are
purged after verification.

On Node 22.23.2 macOS arm64, seven-batch median cipher measurements show original
versus native 2,151/134 ns at 128 UTF-16 units and 33,823,177/521,974 ns at 1,048,576
units. Empty calls favor JavaScript (26/68 ns); these are cipher microbenchmarks,
not whole-agent performance claims. Separate GC-enabled processes retained 16
one-million-unit outputs with similar additional heap (~16 MiB); observed peak
RSS was 218,736 KiB original and 70,368 KiB native. Released outputs return heap
near warmed levels. A separate 2,048-call/512-server-session churn run completes
without errors; final GC heap is ~4.56 MB versus initial ~4.52 MB, while RSS grows
from ~52 MB to ~63 MB. This bounded run is not sustained leak or platform proof.
Evidence is `out/rust-stdio-fixture-*`. Full MCP/poe-agent closure implementation,
supported-platform artifacts and broader stability/performance remain active.

The agent closure now also includes private `@poe-code/agent-defs-rust`. Each
agent has one declarative JSON definition. Both Cargo and the Node build discover
these files; registry order, named exports/types, aliases and capability data
derive automatically. Names default to ids, and argument templates infer an
OTel capture overlay without repeating an empty object. There are no agent-id
branches. Generic templates insert JSON-escaped endpoint suffixes and content
flags. The pure Rust `Registry`, specifiers, capability diagnostics and custom
`Registry::from_json` catalogs use only std and the own protocol path crate.
Bindings share the canonical own NAPI JSON conversion crate.

Node's Unicode lowercase primitive supplies normalized caller keys. Rust derives
lookup/capability data once, and Node caches that immutable policy for routine
checks. A native mismatch in alias-option getter evaluation was reproduced and
fixed while retaining independent returned arrays. Records preserve original
freeze boundaries, including its mutable nested configPaths object. Empty-agent
TypeErrors, model getter order and own-property admission remain compatible.
The first native specifier wrapper measured 573 ns versus 77 ns for the original
small parser. The final Node adapter applies Rust's delimiter/error policy with
V8 string primitives, retaining model substrings in Node and removing per-call
native string copies; the complete UTF-16 Rust parser remains available for Rust
and direct native callers. A test temporarily rejects all native specifier calls
and proves the public Node parser/formatter/normalizer still work. All 63 original
contracts execute the additive adapter; five Rust tests, six native groups,
bidirectional shipped namespace/types, lint and the five-workspace maintained
build closure pass. Actual extracted metadata/exports/Unicode/capability/telemetry
smokes pass with every external npm resolution blocked. Temporary extraction
and tarball are purged.

Final seven-batch medians on Node 22.23.2 macOS arm64 are original versus additive:
resolve 43/37 ns, capability check 247/69 ns, parse 89/67 ns, normalize 135/130 ns,
and typo diagnostic 7,670/2,832 ns. Small differences are machine/workload-specific;
these do not establish end-to-end agent speed. GC-enabled isolated processes
retain 64 specifiers sharing a 917,504-unit model with only ~7.6 KB original/~7.5 KB
additive additional heap. No model copies accumulate. After 32,768 parse,
normalize and diagnostic calls each, additive GC heap grows ~60 KB from first
to last churn samples; RSS grows ~51.5 MB to ~56.3 MB. Warmed standalone RSS is
~45.3 MB original/~45.5 MB additive. The bounded run completes without errors;
broader sustained stability and supported-platform proof remain outstanding.
Evidence is `out/rust-agent-defs-*`. This is another package delivery, not full
MCP or poe-agent completion, and applications still use their original imports.

The configuration closure now has the private `@poe-code/config-mutations-rust`
JSON foundation, available only through `./json`. Its std/own-path Rust core
parses UTF-16 JSONC, retains scalar values and AST spans without duplicating
descendant values, normalizes blank/null documents, derives indentation and
plans localized object/array edits. Duplicate-key admission uses a map rather
than repeated linear searches; numeric property names follow JavaScript order.
Formatting applies ordered changes in one pass rather than repeatedly shifting
the remaining document. Adapted Microsoft editing/formatting algorithms carry
the upstream MIT notice.

Edit planning precedes host value serialization. Missing-path wrappers are
applied to the original JS value so `toJSON` receives the original property key;
invalid parents reject before value hooks run. A concrete failing conformance
test reproduced both the old root-key serialization mismatch and path-toJSON
admission. Native plans are consumed on application and explicitly discarded
when host serialization throws, releasing their Rust source buffers immediately.
Node retains V8 serialization, Date/getter/array-hole semantics and unvisited
patch replacement identities, including cycles. Deep merge/prune operate on
these host properties; they are not represented as fully native arbitrary-object
algorithms. The complete own Rust JSON parser/editor/serializer remains reusable
without Node. JSONC SDK imports occur only in development tests.

Two deliberate corrections are documented: ordinary own `__proto__` keys survive
instead of being lost by the existing JSONC SDK's prototype assignment, and
deleting the final item of `[1,2,3]` produces `[1,2]` rather than the SDK's
reproduced `[1,23]` bug. Both have dedicated regression coverage. Source nesting
is bounded at 512 levels; malformed editor input rejects rather than following
the SDK's tolerant AST recovery. Those restrictions remain explicit differences.
Ten Rust groups (including hundreds of generated/truncated SDK parser cases and
comment/array/EOL edits), seven actual native groups, shipped type checks, lint
and the maintained four-workspace build closure pass. The extracted packed
addon passes JSONC/UTF-16/metadata/edit/host-operation smokes with every bare npm
resolution blocked. It has no production/peer/optional npm dependencies.

On Node 22.23.2 macOS arm64, seven-batch median original/additive times in ns are
small parse 4,387/1,375; 1,734-unit connection config parse 52,755/46,357;
59,221-unit/4,096-property parse 3,154,521/2,158,297; connection insertion
192,792/52,253. These workload-specific figures do not establish whole-agent
speed. Separate GC-enabled processes retain 32 large parsed results with nearly
identical additional V8 heap (~6.39 MB), returning near warmed heap after release.
After 2,048 parse/edit/parse cycles, native first/last GC heap is ~4.025/~4.028 MB
and RSS ~65.9/~68.2 MB. Observed peak RSS original/additive is 93,344/70,784 KiB.
This is bounded churn, not sustained leak, cross-platform or end-to-end proof.
Evidence is `out/rust-config-jsonc-*`.

This atomic delivery is a configuration foundation, not acceptance of the entire
config-mutations package: TOML, YAML, mutation execution, and its original root
and testing exports remain to implement. Applications retain original imports.
The full ten-MCP and nineteen-package poe-agent closure goal remains active.

The next configuration improvement adds the private `./toml` export. The own
UTF-16 Rust parser supports dotted/quoted keys, inline and explicit tables,
arrays of tables, multiline strings/continuations, numeric radices/separators,
safe-integer admission, nonfinite numbers and temporal values. Own Gregorian
arithmetic preserves authored offsets, local date/time forms, millisecond
truncation and the development SDK's observable day-rollover behavior. Node
restores mutable Date subclasses without importing the SDK. The SDK is a
production-free development oracle; adapted table metadata and serialization
layout carry its BSD-3-Clause notice.

The serializer preserves stable getter call order/counts, BigInt, nonfinite
numbers, custom Date ISO hooks and UTF-16 strings. It snapshots host properties
into a compact binary Buffer instead of invoking foreign toJSON hooks or
building/parsing a second JSON document. Native snapshot decoding, Rust literal
parsing, arena tree assembly and Rust formatting use explicit work stacks.
Failing default-stack tests reproduced a real Rust stack overflow at admitted
nesting; the iterative parser and serializer fix it without enlarging the Rust
test stacks. Two isolated 4-MiB-stack Node workers also pass depth-999 array
parsing/serialization, depth-999 Date restoration and 512 configuration cycles.

Two explicit TOML differences remain: overall nesting is bounded to 1,000,
including dotted paths combined with literal nesting (the SDK only bounds its
literal recursion), and array-of-tables headers require both adjacent closing
brackets instead of accepting the reproduced `[[section]` SDK bug. Lone-surrogate
serialization follows the SDK's escaped text; neither parser admits surrogate
Unicode escape values as valid TOML. Raw UTF-16 literals preserve SDK behavior.
Cycle admission fails promptly with the SDK's maximum-depth message. Stable
getter conformance does not prove arbitrary state-changing accessor parity.

The maintained package route passes 21 Rust tests, 13 actual native groups and
shipped declarations. The oracle includes hundreds of valid/truncated/deleted
cases, 750 generated temporal cases, extreme float formatting and complete
UTF-16 error/codeblock/line/column comparison. Lint and the maintained
four-workspace uncached build closure pass. Extracted packed JSONC/TOML exports
pass temporal, UTF-16, safe-own-key, binary-buffer growth and 4,096-property
round trips with all bare npm imports rejected. Metadata has no production,
peer or optional npm dependencies. Evidence is `out/rust-config-toml-*`.

Final seven-batch median original/additive times in ns on Node 22.23.2 macOS
arm64 are small parse 874/1,976 and serialize 334/1,924; 1,979-unit connection
configuration parse 46,876/51,502 and serialize 15,265/54,955; 87,892-unit,
4,096-property parse 10,823,157/3,132,517 and serialize 1,017,862/2,733,178.
Large parsing benefits, while native transfer and snapshot costs still outweigh
savings in smaller parsing and in serialization. No universal or whole-agent
speedup is claimed. Separate GC-enabled processes load only the measured codec;
32 retained large results add about 10.3 MB heap to either implementation and
return near warm heap after release. In 2,048 parse/serialize/parse cycles,
additive first/last GC heap is 4.255/4.278 MB, external memory stays 1.794 MB
and RSS is 84.6/82.6 MB. Observed peak original/additive RSS is
105,744/87,168 KiB. These are bounded local observations, not sustained leak,
platform-matrix or end-to-end evidence.

This remains an atomic package improvement: YAML, mutation execution, factories,
template rendering and the original root/testing exports remain outstanding.
Existing application imports and release wiring are unchanged. The full MCP and
poe-agent dependency-closure rewrite remains active.

The YAML codec foundation now includes an own std-only UTF-16 Rust parser,
composition and serializer plus private `./yaml` napi bindings. The licensed
scanner/event-parser adaptation uses std buffers; serialization adapts YAML 2.9.0
ISC formatting algorithms. The event parser, graph composition and serialization
use explicit work stacks. Overall nesting is bounded to 512. A reproduced u8 flow
depth limit was replaced; depth 511 passes on default Rust test stacks and 4 MiB
Node workers. Alias preflight admits 99 scalar aliases and rejects 100 and nested
amplification; cyclic configuration input rejects promptly instead of overflowing.

Development comparisons cover valid/truncated/deleted documents, core/YAML 1.1
scalars, tag directives, binary/timestamp values, pairs/ordered maps/sets, merge
precedence, typed-key collisions, numeric property order, raw/escaped surrogates,
and thousands of exact default serialization layouts. Reproduced defects fixed
include multiple-tag loss, empty-block chomping, anchor/flow separation, YAML 1.1
NaN cases, binary-key panics, complex alias keys, Date keys with host time zones,
explicit merge Symbol values and array/object merge-key coercion. Tag escapes
remain lexical in verbatim/local tags and decode in declared shorthand suffixes.

Binary native graph snapshots preserve shared/circular objects and default anchor
numbering, one no-argument `toJSON` call per source object, getter order, wrapper
unboxing, Maps/iterables and iterator closure on child hook errors. Parsed Date and
Symbol aliases retain source identities without coalescing independently authored
values. JSONC/TOML share the binary writer without changing their contracts.

Maintained validation: 34 Rust tests, 19 native groups, TypeScript declarations,
Rust fmt/clippy and the four-workspace uncached build closure. Two independent
4 MiB workers each pass depth-511 parse/serialize/parse, Date restoration and
2,048 repeat cycles. Packed JSONC/TOML/YAML exports pass with every bare runtime
npm import rejected. There are no npm production/peer/optional dependencies.

Local Node 22.23.2/macOS ARM64 median nanoseconds, original/native:
small parse 16653/2667 and serialize 5725/3435;
64-property configuration (1425 units) parse 383896/77640 and serialize 134678/91439;
4096-property document (83796 units) parse 233229000/5289875 and serialize 10484812/4166375.
The large original parser's duplicate-key work is substantially more expensive
than the Rust hash-based composition. These measurements do not imply universal
speedups for other workloads or platforms. Retaining 32 large parses adds about
11.2/10.5 MB heap. Separate 256-cycle processes peak at roughly 156 MB RSS either;
no RSS reduction is claimed. The native 1280-cycle run plateaus around 137–140 MB
RSS, 3.48–3.50 MB heap and 1.41 MB external memory after GC. Evidence is retained
under `out/rust-config-yaml-*`.

This remains an incremental codec foundation. Exact SDK warnings/error metadata
and precedence, all authored complex-key/tag formatting, tagged merge-source
edge cases and merge-source alias admission need further conformance work.
SDK-specific Document/node serialization objects are not supported. Mutation
execution, factories, templates and the original root/testing exports remain
outstanding, as does the full MCP/poe-agent closure. Existing application imports,
defaults and release wiring remain intact. The overall goal is still active.

The additive private `toolcraft-design-rust` now has its template foundation:
UTF-16 token-arena parsing, partial discovery/composition, standalone indentation,
sections/inverted sections, dotted own-property lookup with parent fallback,
HTML/raw escaping, lambdas, yield substitution and optional variable validation.
The core uses std only and accepts a caller-supplied environment. Token ownership,
rendering, partial validation and expansion use explicit work stacks. Partial
nesting remains bounded to 100 with explicit cycle diagnostics. Native callbacks
keep arbitrary JavaScript values, lazy getters, receiver identity and array
iterator overrides in the caller; host exceptions retain their identity.

Validation: seven Rust groups, six native groups (including hundreds of generated
layout/output/error cases), TypeScript declarations, fmt/clippy and the six-workspace
uncached maintained build closure pass. Development comparisons use the actual
original design template implementation. Iterator cleanup now matches for-of:
child lookup errors close active iterators; iterator-next errors do not close the
failing iterator. Unused partial getters are never read. Malformed-tag errors
retain their name, description and UTF-16 line/column. Two separate 4 MiB workers
each pass depth-512 rendering and 2048 repeated scope-render cycles. Extracted
packed APIs pass with every bare runtime npm import rejected; there are no npm
production/peer/optional dependencies.

This callback boundary is conformance-oriented and currently slower than JS.
Measured original/native median nanoseconds on Node 22.23.2/macOS ARM64:
literal 509/1696, single name 985/3925, configuration template 3405/11203,
256-item section 69547/1202090. This evidence makes a data-oriented binding path
the next performance step; reducing per-lookup native/host crossings is required.
Standalone Rust callers do not have that native callback overhead. In separate
1280-cycle processes, final RSS is about 59.4/60.0 MB, retained heap 3.70/3.63 MB
and external memory 1.40 MB either. Retaining 32 large section outputs adds about
1.14/0.17 MB heap (JS ropes versus native flat strings); no general RSS reduction
is claimed. Evidence is under `out/rust-design-template-*`.

This does not complete toolcraft-design: colors, layouts, tables, interactive
components and other design APIs remain outstanding. The original production
design imports are intact, and config mutation execution has not been integrated
with this package yet. The full MCP and poe-agent closure goal remains active.

The template binding now has an owned-data graph path. Plain data descriptors
are captured without JSON hooks into a flat binary graph retaining UTF-16,
undefined, nonfinite numbers, BigInt, sparse arrays, shared references and cycles.
The own Rust graph environment performs property lookup, scope traversal and
array iteration without host crossings. Object coercion and partial access stay
in the caller. Proxies are rejected before reflective traps; getters, functions,
custom prototypes/iterators, partial accessors and patched coercion intrinsics
use the callback environment. Graph capture is bounded and otherwise falls back.
The core now uses its own mcp-protocol-rust path crate for number formatting;
there are still zero external core crates or npm runtime dependencies. Construct
a fresh DataEnvironment per render; its scope/iterator handles are call-local.

Validation now passes eleven Rust groups and ten native groups, types, maintained
lint and the uncached maintained six-workspace build. The native growth test
reproduced a Buffer receiver/reserve ordering bug before the fix. Snapshot decoder
coverage rejects truncated, overcounted, unknown-tag, dangling-reference and
trailing-byte buffers. Native cases cover 256-item capture, sparse arrays,
nonenumerable values, cycles, proxy trap order and mutations from partial getters
and coercion hooks. Two 4 MiB workers pass depth512 and 2048 render cycles.

Same-process original/data/callback medians in nanoseconds (Node22.23.2 ARM64):
literal366/1082/909, name676/3908/3396, config1818/5023/7102,
256-item section37677/216436/764666. Capture reduces crossings on larger
sections, but is still slower than JS and can regress tiny views. In separate
1280-cycle memory processes, original/data final RSS is 61.2/75.3 MB, retained
heap4.01/4.08 MB and external1.67MB either. The last three data samples are
74.96/75.17/75.27MB RSS; this finite run is stability evidence, not a general
leak-free or lower-memory claim. Thirty-two retained outputs add1.14/0.31MB heap.
Evidence: out/rust-design-template-data-*. Existing design imports remain intact;
the full rewrite, remaining design APIs and configuration execution are incomplete.

Configuration file execution now has the additive `./execution` subpath for
ensureDirectory, removeDirectory, removeFile and chmod. An own Rust state machine
requests injected stat/lstat/read/readdir/mkdir/rm/unlink/chmod effects and owns
sequencing, ECMAScript UTF-16 trimming, permission masking, guard admission,
symlink diagnostics and outcomes. Node supplies platform path operations and
foreign resolver/regex/observer behavior. Runtime controls are requested lazily,
including dryRun after awaited I/O and permission mode again at the host call.
This avoids capturing unrelated or unused option getters. Pending details still
resolve separately from application, and onStart remains outside the error
boundary. Unknown/remaining mutation kinds reject as unsupported in this partial
subpath; backup/restore, config/template handlers and root/testing/factory exports
remain outstanding. Production wiring is unchanged.

Validation: forty Rust groups, twenty-six native groups, strict declarations,
maintained fmt/clippy and seven-workspace uncached maintained build pass. Native
comparisons use the current TS execution with memfs only: path quirks/containment,
mapping, resolver count, symlink rejection in dry runs, force/empty/support cases,
BOM/Unicode trimming, regex lastIndex, inherited error codes, host exceptions,
observer boundaries, getter order and async context mutation. The lazy-control
regression was reproduced before replacing eager captured options with Rust
requests. Both 4 MiB workers pass depth512 and 2048 mixed mutation cycles.
Packed standalone execution passes with bare npm resolution blocked and zero
production/peer/optional dependencies. Original SDK and memfs are dev only.

In-memory original/native median ns: ensure3074/14131, remove2189/12835,
directory2599/15770, chmod2967/17798 (Node22.23.2/macOSARM64). These crossings
cost more than JS when platform operations are instant; real filesystem latency
is additional. Separate 1280-cycle original/native processes end at72.1/77.4MB
RSS and8.66/8.65MB retained heap,2.18MB external either. Both implementations
are loaded in each memory process, so this measures operation deltas, not isolated
package load size. No performance, lower-memory or universal leak-free claim is
made. Evidence: out/rust-config-execution-*. The full goal remains incomplete.

The configuration core now includes `atomic::AtomicMachine` and an internal native
platform adapter for document/restore writes. Exclusive creation and rename,
symlink walks, exactly ten collision retries, cleanup policy and host error-token
propagation are owned in Rust. Write collisions preserve another writer's temp;
rename collisions clean the created temp before retry. Other write/rename errors
clean before rethrow, while cleanup failure retains the original host error.
Target checks and temporary-path generation remain outside the retry boundary;
collision-code getters are not read for those errors. UTF-16 diagnostics retain
authored paths. Core ownership and traversal are iterative. No existing
application uses this adapter, and it is not a public npm export yet; integrating
backup/config/template/restore handlers remains outstanding.

Validation: forty-seven Rust groups, thirty-four native groups, types,
maintained lint and the uncached seven-workspace maintained build pass. Rust tests
cover protocol sequencing and error tokens. Native tests use memfs for actual
exclusive creation, rename, collision preservation, cleanup, error identity,
symlink boundaries and lazy error-code getters. Success/failure/collision effect
traces match the current SDK writer via its configMerge handler, with only
nondeterministic temporary names normalized. Both 4 MiB workers pass depth512,
2048 successful 32768-byte writes and128 failed-rename cleanup cycles. An initial
microtask-only memory run exposed deferred-finalizer retention of Rust buffers:
RSS reached96.9MB at1280 writes despite stable JS heap. Terminal states now release
their owned payloads immediately, and file mutation states release path walks.
At the same1280 writes RSS is54.4MB; an extended5120 writes ends56.2MB, then1024
failed renames ends57.4MB, with4.12MB retained heap and1.76MB external. This fixes
this implementation's buffer lifetime; it is not evidence of superiority over JS.
Evidence is captured in out/rust-config-atomic-*; no relative performance,
lower-memory or universal leak-free claim is made.
The packed internal adapter passes with all external npm resolution blocked.
The full goal remains active and incomplete.

File backup and restoration now run through an own Rust BackupMachine in the
`./execution` API. The core owns first-baseline/missing-marker admission, generated
name scanning, UTF-16 lexical latest selection, timestamp formatting, exclusive
collision suffixes, cleanup, restoration ordering and backup consumption. The
Node adapter supplies injected filesystem/path/calendar effects, including the
host Date.parse admission behavior. Controls stay lazy: once is read after target
link checks and again only for a missing target; dryRun after reads/discovery.
Restore checks the backup before reading/deleting and invokes the own atomic
write engine before consuming it. Missing target deletion is admitted only for a
missing marker; missing backup read/delete errors propagate. Terminal states
release owned buffers. The adapter retains only the one pending host error, so
collision retries do not accumulate exceptions. The SDK's .missing-N collision
names remain unrecognized on restore, and lexical suffix ordering remains
lexical rather than numeric; this round preserves actual behavior.

All six fileMutation factories are generated from declarative Rust layouts;
foreign resolver/regex identity and option getter order remain in the host.
No original production imports or release wiring changed. Configuration/template
handlers and factories plus root/testing exports remain outstanding.

Validation: fifty-five Rust groups, forty-one native groups, strict declarations,
maintained fmt/clippy and the uncached seven-workspace maintained build pass.
Native comparisons use the actual current SDK with memfs and a fixed clock for
backup baselines/consumption/dry runs, forgery/date/suffix cases, lexical latest,
partial write cleanup, error identity, missing-code boundaries, symlinks, lazy
controls/date predicates and all factory getter/identity cases. Both4 MiB workers
pass depth512 and2048 16384-byte backup/restore cycles. A further test admits256
exclusive collisions then succeeds and proves cleanup code getters stay unused.
The packed file factories and native round trip pass with bare npm resolution
blocked; production/peer/optional dependencies remain zero.

Sequential measured16KiB round trip in memfs: original159993/native212065ns
(Node22.23.2/macOSARM64). Memfs memory growth appears in both implementations:
its rename-over-existing path retains replaced inodes. A standalone memfs-only
reproduction (no Rust or config package) shows1 visible file but4/260/516 retained
inodes after0/256/512 replacements. Draining event queues does not remove those
inodes. This makes its process memory samples insufficient to attribute growth
to the rewrite. A separate controlled string-map protocol host with drained
queues runs5120 cycles: original/native final RSS77.6/108.6MB, retained heap8.88/
8.86MB, external2.18MB either; last three native RSS samples108.51/108.56/108.56MB.
Both implementations are loaded in each process, so this measures operation
deltas, not isolated package load. This finite stability evidence does not show
a speed/lower-memory advantage or universal leak-free behavior. Evidence under
out/rust-config-backup-*. The full MCP/poe-agent goal remains active and incomplete.

Configuration merge/prune/transform execution and all three configMutation
factories are now implemented in the additive `./execution` API. Own Rust
ConfigMachine controls format detection/selection, read/parse ordering, fresh
documents, invalid-backup admission, guard/value checks, serialization decisions,
dry runs, deletion, create/update/noop outcomes and atomic-write requests. Invalid
backups extend BackupMachine with the SDK's separate destination-guard boundary,
exclusive suffix retries and cleanup behavior. Missing prune stops before format
selection; invalid prune leaves the file intact; merge/transform back up invalid
content before invoking foreign callbacks. The Node adapter retains foreign
document/patch/transform identities, getters, receivers and exception identity;
host merge/prune/prefix property algorithms remain JavaScript. Do not claim that
arbitrary JS graphs now merge in Rust. Portable `config_data` owned-value APIs
use explicit clone/merge/prune work stacks, depth1000 bounds, ordered keys,
Undefined skipping, array replacement, repeated prefix maps and shallow managed
subtree replacement. They preserve the SDK's empty-child prune changed-flag quirk.

Validation: seventy Rust groups (including100 generated owned merge/prune SDK
comparisons), forty-eight native groups, strict declarations, maintained
fmt/clippy and the uncached seven-workspace maintained build. Native tests cover
all formats, invalid-backup collisions and symlinks, guards/resolvers/dry runs,
format error ordering, fs/observer exceptions, prefix behavior, getter/receiver
ordering, in-place transforms and factory field getter/reference identity.
Two4 MiB workers pass500-level JSON, depth512 paths and2048 config round trips
each. Packed JSON/TOML/YAML invalid backup/merge/prune/transform pass with bare
npm resolution blocked; no production/peer/optional npm dependencies added.
Template handlers/factories and root/testing exports remain outstanding.

Sequential controlled-host64-field JSON merge/prune/transform round trip:
original180459/native223173ns onNode22.23.2/macOSARM64. Separate controlled-host
5120-cycle checks retain original/native RSS106.43/104.02MB, heap9.47/9.07MB,
external2.22MB either. Native last three RSS samples104.02MB; original105.07/
106.43/106.43MB. Both modules load in each process; these finite samples do not
prove a general speed, memory or universal stability advantage. Evidence under
out/rust-config-config-*. The full MCP/poe-agent goal remains active/incomplete.

The template native bridge is now reusable through the own
toolcraft-design-rust-napi-core path crate. The design addon reexports it; other
own addons can embed the same registered rendering/data callbacks without
copying Rust bridge logic. The private JS engine adapter accepts its native
module and isolates each render's foreign handles/iterators. The package's public
API and own-data selection behavior are unchanged. This keeps dependent packed
addons self-contained without an npm production dependency or a second addon.
Eleven Rust groups, eleven native groups, declarations, maintained lint (including
the shared bridge) and six-workspace uncached build pass. The new failing-first
test proves nested independent engine renders and foreign getter error identity;
all existing generated SDK comparisons still pass. Packed design rendering and
partial/error behavior pass with bare npm resolution blocked. Evidence under
out/rust-design-embed-*. This is preparatory reuse for config template handlers,
which remain outstanding; the full goal remains active and incomplete.

Template write/JSON merge/TOML merge handlers and all three templateMutation
factories now run through own TemplateMachine. It checks loader support before
application target resolution, then load/context/render/parse/read stages.
Write compares the rendered string and retains dry-run/create/update/noop
outcomes. Merge composes ConfigMachine::TemplateMerge, which skips value/format
admission and uses full serialization while retaining invalid-backup/dry-run/
atomic-write policy. The own design bridge embeds directly into the config
addon; the private parameterized JS engine/data adapter is copied into its
packed dist by the maintained build preparation. Its dev dependency declares
the build closure; runtime npm dependencies and production integrations stay
unchanged. HTML escaping during execution differs intentionally from the raw
configuration-facing render helper, matching the actual SDK. Callback exceptions
and template parse causes stay in the host; discarded machines release owned
buffers on exit. Shared factory metadata now exposes all layouts in one own
native snapshot; it does not duplicate layout converters per factory family.

Validation: seventy-five Rust groups, fifty-six native groups, declarations,
maintained fmt/clippy and eight-workspace uncached maintained build pass.
Failing-first tests cover loader-before-target ordering, write outcomes,
rendered parse failure, full serialization, invalid recovery, all factories'
getter/reference order, canonical noops, raw helper escaping and foreign loader/
context/getter/filesystem error identity. Two4 MiB workers pass500 cyclic render
scopes, depth512 path and2048 template write/merge cycles each. Packed template
and config execution run with external npm resolution blocked, including the
embedded native bridge. Original root/testing exports remain outstanding.

Controlled-host64-item prompt write plus64-field JSON template merge round trip:
original48000/native135105ns onNode22.23.2/macOSARM64. Separate5120-cycle runs
retain original/native RSS103.96/109.22MB and heap9.46/9.43MB, external2.30/2.58MB.
Native last three RSS109.13/109.15/109.22MB; original103.96MB allthree.
Both modules are loaded in each process; no speed or lower-memory advantage,
universal stability or leak-free claim follows. Evidence underout/rust-config-
template-*. The full MCP/poe-agent goal remains active and incomplete.

The config-mutations-rust root now exposes every runtime symbol from the actual
original SDK, including all mutation families, runner, raw render helper,
isConfigObject, filesystem read/existence helpers, own-code ENOENT classification
and safe timestamps. Node handles foreign error/property/Date and injected fs
behavior; own Rust safe_timestamp is shared by backup naming and the public
timestamp bridge. The root types are assignable to typeof the original SDK in
strict TypeScript. Unknown mutation kinds now preserve the SDK's default pending
details/error and never read an unsupported target getter, validated by a
failing-first test. Export/main/types metadata is additive; no production imports
or release changes. Testing export remains outstanding.

Validation: seventy-six Rust groups, sixty native groups, declarations including
whole-root SDK assignability, maintained fmt/clippy and eight-workspace uncached
maintained build pass. New tests cover root symbol equality, actual Date admission
without a patched global clock, raw render behavior, own/inherited/function error
codes, code getter exceptions, read/stat receiver/error identity, extended-year
host clock formatting and unknown observer details. Packed root/config/template
APIs pass with bare npm resolution blocked; all dependency categories remain
empty at runtime. Evidence underout/rust-config-public-*. Prior finite workload
and memory limits still apply; no general performance/memory/stability advantage
is claimed. The full MCP/poe-agent goal remains active and incomplete.

The original config testing API now has an own additive rewrite: createMockFs
and six parse/serialize helpers. MockMachine uses std-only injected admission
requests for lazy exclusive/recursive options, file/prototype membership,
directory/parent existence, stat modes, read/write/mkdir/unlink/rename/list/
chmod/exists actions and exact SDK error code/message construction. Its terminal
states release path buffers; the host always discards on exit, including foreign
option exceptions. Public files Record/directories Set, Node path normalization,
UTF-16 path parts, buffers/views, prototype membership, getter evaluation and
list iteration remain in the host. They retain caller-visible mutation identity.
No physical filesystem fixture, SDK production dependency or production wiring
change. Helpers bind the own codecs; public root/testing runtime symbol sets and
strict type surfaces match the current SDK. This is API coverage, not a claim
of universal codec conformance or whole-goal completion.

Validation: eighty Rust groups, sixty-four native groups, whole testing SDK
type assignability, maintained fmt/clippy and eight-workspace uncached maintained
build pass. Failing-first tests compare every mock method/path/buffer/error and
mutable state to the SDK, including lazy option/prototype/Set effects, and run
the own full mutation API through the own mock. Two4 MiB workers pass depth512
paths and2048 merge/backup/transform/restore cycles each. Packed root/testing/
template/config APIs run with bare npm resolution blocked; runtime dependency
categories stay empty. A5120-cycle mock memory run including throwing options
per cycle retains original/native RSS58.80/60.69MB, heap5.49/5.52MB, external1.47MB
either; last native RSS60.65/60.69/60.69MB. Both modules load in each process.
No general performance/memory/stability advantage or leak-free guarantee.
Evidence underout/rust-config-testing-*. The full MCP/poe-agent goal is active
and incomplete; codec metadata/edge conformance and platform acceptance remain.

The maintained config Rust unit route now cross-runs every current original
config-mutations/fs-utils unit case against own Rust-backed APIs through a
development-only Vitest resolve mapping. The original source/tests are unchanged;
no original implementations execute as the mapped handlers/codecs/mock helpers.
The mapping is restricted to the two actual current SDK test importers, so
normal production resolution is untouched. Vitest stays dev-only, uses no cache,
one fork and a2-second case timeout. Internal format registry/get/detect behavior
now also has own Rust selectors and a stable host codec registry, including
unsupported-empty error distinction versus mutation's cannot-detect admission.
Private format adapters do not expand the package's public export set.

Validation: eighty-one Rust groups, sixty-four native groups and all260 current
SDK unit cases pass, plus strict root/testing SDK type assignability, maintained
fmt/clippy and eight-workspace uncached maintained build. The failing-first SDK
run proves original tests resolve the missing own format module before the new
implementation; its three fs utility cases already ran against own helpers.
Packed whole root/testing/template/config APIs still pass with bare npm imports
blocked; no production/peer/optional dependencies added. Evidence underout/rust-
config-full-*. This is concrete current-suite conformance, not proof of every
codec/SDK edge or native platform parity. Prior intentional documented parser/
editor divergences and finite memory/performance limits remain. Full MCP and
poe-agent closure work remains active and incomplete.

MCP support descriptors now live in the six relevant existing own Rust agent
definition JSON files. Registry::from_json reads optional object-valued
mcpConfig into Definition::mcp_config, separate from public agent metadata.
Static paths, config keys/formats/server shapes and Claude Desktop's declarative
platform/default paths/output format match the actual agent-mcp-config data.
The existing ordered definition discovery derives supported order without a
second provider list, provider conditionals or new ordinal fields. Future own
MCP catalog generation can derive support from that same one agent file.
This is preparatory data/API for agent-mcp-config-rust; its own handlers are not
implemented yet. The Node catalog's runtime API, metadata and freeze semantics
are unchanged; original TS definitions/providers/configs remain untouched.

Validation: seven Rust groups, six native groups, all63 current catalog SDK
unit cases, strict declarations, maintained fmt/clippy and five-workspace
uncached maintained build pass. Failing-first groups validate ordered six-agent
MCP discovery, hidden metadata separation, desktop output-format data, optional
custom descriptors and rejection of nonobject MCP descriptors. Packed catalog
retains nine frozen public definitions/aliases without exposing mcpConfig and
runs with bare npm resolution blocked; runtime dependency categories remain zero.
Evidence underout/rust-agent-defs-mcp-*. No performance/memory advantage claimed;
the full MCP/poe-agent goal remains active and incomplete.

Configuration native bridge conversion/registration now resides in the own
config-mutations-rust-napi-core path crate; the original additive config addon
reexports it. All private JS adapters load one central native module, so an own
dependent addon can embed the same Rust bridge and redirect that one bootstrap
without duplicating converters or shipping a second addon. napi-derive remains
declared directly on the addon manifest for napi-rs CLI artifact generation.
The maintained lint route also checks the shared bridge's format/clippy scope.
No public SDK behavior, production imports, release wiring or runtime npm
dependencies changed. This is the green/refactor phase against the existing
failing-first SDK/binding tests, preparing own agent-mcp-config embedding.

Validation: eighty-one Rust groups, sixty-four native groups, all260 current SDK
cases, declarations, maintained lint including the shared bridge, eight-workspace
uncached build and packed root/testing/template/config smoke with bare npm
imports blocked pass. Native artifact generation actually compiles the new
shared bridge; no skip-artifact warning appears. Evidence underout/rust-config-
embed-*. Existing finite performance/memory/platform limitations remain. The full
MCP/poe-agent goal remains active and incomplete.

## Agent MCP configuration rewrite

Added private `agent-mcp-config-rust` with the compatible root TypeScript API,
six-agent catalog derived from the existing own agent definitions, aliases,
platform paths, standard/OpenCode/Goose shapes, validation and configuration
conflict/removal policies. Rust controls capability ordering and decisions;
the host preserves arbitrary JavaScript getters, object spreads, references,
iterators, exception identities, WHATWG URLs and deep equality. Configuration
execution, JSONC/TOML/YAML codecs and templates are embedded from the shared
own native bridge into one addon, with no npm runtime/peer/optional dependencies.
Original packages, production imports and release wiring remain unchanged.

Failing-first tests exposed both unknown-platform coercion and unbounded native
wrapper allocation in sequential operations. Platform fallback now avoids
coercing unknown values. Validation/decision wrappers are reused in bounded
pools and always discard operation state. The finite shape policy is compiled
from the same Rust machine into a capability graph, removing per-field native
transitions while retaining exact host read/assignment ordering. Nested calls
and repeated throwing getters remain isolated. Graph traces match the Rust
machine across all 96 style/flag combinations; shape computation follows that
Rust-generated graph in JavaScript rather than crossing into Rust per field.

Validation: twelve Rust groups, thirteen native groups, strict SDK type
assignability, all 63 actual current SDK tests, maintained fmt/clippy and a
twelve-workspace uncached build pass. Two 4 MiB-stack workers perform 9,216
configure/remove operations over all six agents and three platforms. Packed
root API passes stdio/HTTP idempotence, conflict and removal for every agent and
platform with bare npm resolution blocked; exactly one native addon is present.
Evidence: `out/rust-agent-mcp-{test,lint,build,pack-smoke}.log`; failing-first
catalog/policy/native/wrapper/platform logs and isolated performance logs.

Finite performance evidence: three-shape native snapshots reduce the earlier
per-field native path from about 10 microseconds per shape to 345–472 ns.
The original remains faster for these small documents; configure/remove
samples are 191–331 microseconds per native pair. Separate-process memory
samples include 12,288 subsequent configure/remove pairs across six agents with GC and event-loop idle
between blocks; native RSS rises from 96.1 to 120.1 MiB while its JS heap goes
from 5.10 to 5.29 MiB. Tight microtask-only measurement starves native finalizer
delivery; wrapper reuse reduces that allocation pressure, but RSS still does
not establish a memory advantage or a leak-free guarantee. No broad speed,
stability or platform claim follows from these local measurements. Python
adapters and the full remaining MCP/poe-agent closure are still unfinished.

## YAML parser support for frontmatter

The own YAML core now exposes `ParseOptions`/`parse_with_options` for duplicate
key and object-root admission. The existing `parse` and Node config APIs retain
strict unique keys and object roots. The shared native bridge accepts optional
private flags and returns raw diagnostic reason/UTF-16 offset alongside its
existing formatted message/line/column. This supports own frontmatter parsing
without importing a production YAML SDK; the existing parser defaults are
already YAML 1.2 (YAML 1.1 activates only through a document directive).
Failing-first Rust/native groups cover last-key-wins mapping values, admitted
array/scalar roots, retained default rejection and duplicate-key offsets.
Validation: 82 Rust groups, 65 native groups, all260 current SDK cases,
declarations, maintained lint/shared lint, eight-workspace uncached build and
packed config root/codecs/template smoke pass. Evidence under
`out/rust-config-yaml-options-*.log`. Frontmatter package work is ongoing.

YAML graph snapshot capture is now a reusable private host module. Configuration
serialization retains aliases by default; frontmatter can opt out so repeated
objects and toJSON hooks are independently emitted, matching the current SDK's
`aliasDuplicateObjects: false` behavior. The own shared Rust bridge also exposes
its parsed YAML date/symbol metadata snapshot conversion for dependent addons.
Validation: 82 Rust groups, 66 native groups, all260 actual current SDK cases,
declarations, maintained lint/shared lint, eight-workspace uncached build and
packed configuration root/codecs/template smoke pass. Evidence under
`out/rust-config-yaml-snapshot-*.log`; default configuration API behavior is
unchanged, while the own frontmatter package remains in progress.

## Frontmatter rewrite

Added `frontmatter-rust` with the complete current root API and strict SDK type
assignability. Its portable Rust core owns UTF-16 fence/body offsets, BOM and
line-ending handling, YAML duplicate/root admission, source-line starts and
diagnostic translation. The own YAML parser is embedded through the shared
bridge into one addon. Host adapters retain Date/Symbol identities, structural
kind-error narrowing, mutable/lexically-bound line-counter methods, JavaScript
getters/toJSON/iterators and acyclic traversal with iterator cleanup. Shared
objects stringify independently without aliases. No npm runtime/peer/optional
dependencies or production integrations were added.

Validation: seven Rust groups, eight native groups, all18 actual current SDK
cases, declarations, maintained fmt/clippy, nine-workspace uncached build and
packed root smoke with bare npm imports blocked pass. Failing-first evidence
covers fence/offset/parse/native APIs. Two 4 MiB-stack workers handle 400-level
documents, 2,048 round trips and rejection past the 512-depth limit. Foreign
getter errors, no-options access for absent/missing fences, timestamp aliases,
prototype-safe keys, scalar schema, shared-object emission and lexical line
counter receivers are checked against the actual SDK.

Separate-process 64-field/32-item round trips measure native 114.8–117.4 us and
original449.4–478.1 us. Across 8,192 subsequent cycles with GC and event-loop
idle between blocks, originalRSS97.1–99.6 MiB and heap6.01–6.09 MiB compare with
nativeRSS117.4–119.1 MiB and heap3.92–3.18 MiB. This workload shows faster native
round trips, lower measured JS heap and higher resident memory; it establishes
no universal advantage or leak-free guarantee. YAML recovery/warnings/all
diagnostics/complex keys remain incompletely matched, cyclic aliases reject
under bounded expansion, and depth512 is an intentional bound. Evidence under
`out/rust-frontmatter-{test,lint,build,pack-smoke,original-performance,native-performance}.log`.
The overall MCP/poe-agent rewrite and minimum effort requirement remain unfinished.

The frontmatter conversion/registration bridge now resides in the own
`frontmatter-rust-napi-core` path crate, reexported by its original addon.
This lets dependent own addons embed the same frontmatter/YAML/template bridge
and redirect the host's central native bootstrap. The root retains a direct
napi-derive dependency for CLI artifact/type generation. Shared fmt/clippy is
part of the maintained lint route. This is a refactor against the existing
failing-first tests; no public behavior or production imports changed.
Validation: seven Rust groups, eight native groups, all18 actual SDK cases,
declarations, lint/shared lint, nine-workspace uncached build and packed root
smoke with bare npm imports blocked pass. The build genuinely compiles the new
shared bridge; evidence under `out/rust-frontmatter-embed-*.log`.

## Owned configuration composition core

Added the initial own `config-extends-rust` crate with portable merge and prompt
composition cores. Merging owns first-layer priority, null deletion, undefined
and empty-prompt inheritance, nested gap filling, array replacement/cloning and
UTF-16 escaped provenance. Explicit work stacks admit depth1,000 and reject
greater depth; a 4 MiB Rust thread checks both nested merging and array cloning
at the boundary. Owned Rust trees cannot express object-reference cycles.
Prompt composition owns higher/lower yield wrappers, consumed base indexes,
first nonempty source, nonstring stop behavior and typed policy error messages.

Validation: ten Rust groups and maintained fmt/clippy pass; 64 generated
priority/null/array/provenance cases compare with the actual current SDK through
in-memory stdin/stdout. Failing-first core/prompt logs and green/lint evidence
reside under `out/rust-config-extends-*.log`. This is a Rust core phase, not the
full package rewrite: document discovery/resolution, arbitrary JavaScript graph
semantics, Node/Python adapters and performance/memory acceptance remain.

### config-extends document core, 2026-09-20

Added additive Rust Markdown/YAML/JSON document parsing with extension precedence,
BOM handling, lone-CR normalization, missing-fence fallback, prompt overrides,
ECMAScript string trimming and platform-supplied relative-path validation for
`extends`. Removed fields filter traversal-indexed Date/Symbol alias metadata
without changing the identities of retained aliases. Prompt overrides preserve
existing property position. Core JSON has a 512-depth/16 MiB bound and its own
diagnostics; full YAML recovery/diagnostics remain limited by the shared parser.

Validation: 16 Rust groups, fmt/clippy, and 144 generated document cases compared
with the actual current TypeScript implementation via in-memory stdin/stdout.
Initial missing-module and property-order failures and final green/lint logs are
in `out/rust-config-extends-document-*` and `out/rust-config-extends-order-red.log`.
Discovery, resolution, native bindings and full package acceptance remain open.

### config-extends owned discovery and resolution, 2026-09-20

Added Rust directory/extension-priority discovery with containment before reads
and host error identity. Owned resolver classifies typed chain layers, resolves
named/relative bases, detects cycles, caps extends depth at five, handles optional
auto-extension, recursively loads Markdown partials in DFS order, composes prompts,
renders optional owned template graphs through the own design core, and retains
field/prompt provenance and document/partial chains. Paths and I/O are supplied
by a host; cores retain zero external Rust dependencies. The host must classify
own ENOENT separately and own ENOTDIR only for relative base reads.

Validation: 26 Rust groups and fmt/clippy pass. An additional 64 generated
resolver cases match the current SDK's results, errors and ordered filesystem
reads; memory-only fixtures and stdin/stdout comparisons create no fixture files.
Evidence: `out/rust-config-extends-{discover,resolve}-{red,green,lint}.log`.
Rooted prompt-document resolution, native/foreign-graph adapters and performance
acceptance are still incomplete. These are additive cores, not full acceptance
of config-extends or the larger MCP/poe-agent rewrite.

### config-extends rooted prompt-document core, 2026-09-20

Added Rust prompt-document resolution with original-root lexical and canonical
symlink containment, absolute base admission, last-document-wins memory overlays,
optional missing-document inheritance, and separate template/rendered-prompt
resolution with metadata and provenance. Path operations and canonical lookup
remain host capabilities. Owned missing paths become policy errors; an absent
host exception object cannot be retained by this core's Option-based interface.

Validation: 30 Rust groups plus fmt/clippy pass; 32 additional generated cases
match actual SDK rooted-overlay/optional/template results, errors and filesystem
read ordering. Tests explicitly cover symlink escapes and canonical roots. Logs:
`out/rust-config-extends-rooted-{red,green,lint}.log`. Async/native/foreign-graph
adapters and full package acceptance remain unfinished.

### config-extends resumable async cores, 2026-09-20

Discovery, resolution and rooted prompt-document resolution now return standard
Rust futures. Host reads/canonical lookups may suspend; no executor/runtime crate
is added. Resolver state stays in the future across I/O rather than rerunning
prior parsing, discovery or reads. Public futures intentionally need not be Send
so native adapters can drive them on the originating JavaScript/Python thread.

Validation: 32 Rust groups and fmt/clippy, including all 240 generated SDK
document/resolver/rooted cases. Manual pending-I/O tests assert repeated polls do
not replay requests, resumption retains ordered discovery, and cancellation stops
later reads. Ready in-memory hosts must complete in one poll. Failing-first and
green evidence: `out/rust-config-extends-async-{red,green,lint}.log`. Native adapters
and arbitrary foreign-runtime graph behavior are still unfinished.

### Shared std-only binary snapshots, 2026-09-20

Moved the own binary tree/graph decoder and parsed-value metadata conversion into
`config-mutations-rust::snapshot`. The native bridge reexports this single source,
so additional Rust/binding consumers need no duplicated codec or napi dependency
in their cores. Host hooks, JavaScript adapters and production imports are unchanged.

Validation: 84 Rust groups and focused maintained configuration tests pass, including 66 native groups,
all 260 current SDK cases and new truncation/trailing/depth/lone-surrogate/opaque
token core tests; fmt/clippy/shared-bridge lint and the eight-workspace uncached
maintained build closure pass. Evidence:
`out/rust-config-snapshot-core-{red,green,lint,build}.log`.

### config-extends standalone Node parsing/merging, 2026-09-20

Added a zero-npm-runtime-dependency private package and one self-contained addon
embedding the shared frontmatter/configuration/design bridges. Node parseDocument
and mergeLayers have SDK-assignable declarations. Rust owns foreign-handle merge
decisions, explicit traversal, pruning and provenance; host operations preserve
getter/layer-access order, sparse/custom array maps, prototypes, opaque identities,
exceptions and iterator cleanup. Ordinary eligible data uses one binary snapshot
and native owned merge; proxies/getters/species/custom maps take the handle path.
Wide owned layers now index borrowed UTF-16 keys instead of repeated linear scans.
Timestamp scalar YAML roots spread to empty records, and root errors retain lone
UTF-16 filename units. Existing TS implementations and production imports remain.

Validation: 35 Rust groups, 12 native groups, all 55 current SDK parse/merge cases,
strict type assignability, fmt/clippy, and the 11-workspace uncached maintained
build pass. Packed imports run with bare packages blocked, exactly one addon and
zero runtime/peer/optional dependencies. Two 4 MiB workers pass 1,000-deep object
merges, 200-deep dense arrays, bounded excessive-array rejection and 1,024 combined
parse/merge cycles. Native and packed evidence is in `out/rust-config-extends-*`.

A 400-level foreign callback error caused SIGSEGV in the initial test process.
Shallow nested errors preserve identity; callback mapping is now capped at 32,
with direct/main/4 MiB worker/packed bounded rejection verified. Ordinary eligible
snapshots cap at depth256 and fall back; iterative object handling caps at1000.
Full YAML diagnostics/recovery/cyclic-alias conformance and async Node APIs remain
unfinished. This package is not accepted as a full rewrite yet.

Performance on a32-field fixture in fresh sequential processes: Markdown parse
~25.6–27.5us vs SDK~120.6–123.6us. Snapshot merge~33.3–35.1us vs SDK~16.3–18.8us;
the callback path previously took~293–303us. Indexing2048-field owned input improves
~6.3–6.5ms to~2.7–2.9ms, still above SDK~1.45–1.51ms. After8192 additional parse and
merge cycles with explicit GC/idle, native RSS61.7→61.8MiB/heap4.15→4.15MiB; SDK
RSS98.3→100.5MiB/heap8.73→8.74MiB. These fixtures support a parsing/memory benefit,
not a general speed or leak-free/stability guarantee.

### Deferred foreign resolver preparation, 2026-09-20

Added `resolve::prepare` with document position, ordered unmerged document/base
layers, composed prompt provenance and source chain. Owned resolution now merges
this representation together with data overrides and fallback layers. A failing
core test reproduced the missing preparation API; the passing regression shows
that a high-priority object still inherits fields below a document scalar. Host
admission/render capabilities use own defaults and allow foreign runtime values
without reading original data layers early. Rooted hosts preserve these capabilities.
Async Node APIs are still unfinished; this is an independently usable core step.

### Runtime-free async Node resolver bridge, 2026-09-20

Delivered Node `findBase`, `resolve`, and `resolvePromptDocument` through a
manually polled Rust future on the originating JS thread. Synchronous path,
admission and template host callbacks keep runtime values in Node; reads and
canonical lookups yield explicit requests and resume without replay. Completed
machines explicitly discard their futures/callback references and reuse a pool
of at most eight idle wrappers. Original data layers remain foreign until final
merging; opaque Date/Symbol aliases and view getters/lambdas retain host behavior.
A missing-document host capability preserves original mandatory ENOENT exceptions.
The package still uses one standalone addon and zero npm runtime/peer/optional
dependencies. No external runtime crate was added to the own core.

TDD evidence: all three async Node APIs initially failed as missing; the owned
preparation regression first failed compilation. Passing validation includes
36 Rust groups, 17 native groups, all117 actual current SDK parse/merge/discover/
resolve/prompt-document cases, strict API assignability, package fmt/clippy and
the11-workspace uncached maintained build. Native comparisons exercise24 rooted
path/overlay/optional/symlink cases including call order.192 concurrent resolver
runs preserve separate callbacks. Main and packed imports each run two4MiB workers
with1024 resolver and1024 prompt-document cycles. Packed smoke blocks external
imports, counts exactly one addon, checks zero runtime dependencies and exercises
the default Node filesystem. Temporary packed assets were purged; evidence remains
under `out/rust-config-extends-async-*`.

Fresh sequential process measurements: native resolver96.4–107.1us vsSDK45.0–62.1us;
rooted prompt155.1–166.1us vsSDK94.8–101.0us. After4096 additional cycles of each,
nativeRSS63.5→63.7MiB/heap4.64→4.66MiB; SDKRSS87.3→87.6MiB/heap9.15→9.20MiB.
These fixtures show a resolver speed regression and lower observed resident memory;
no general performance, leak-free or stability guarantee is claimed. Document/base
metadata accessor stages are not yet fully SDK-compatible; transfer bounds are
512 levels/100,000 nodes. YAML diagnostics/recovery/cyclic aliases, cross-platform
artifacts, remaining MCP applications and the full poe-agent closure are unfinished.

### Frontmatter unfinished-flow source context, 2026-09-20

A direct-admission comparison reproduced a shared frontmatter error mismatch for
an unfinished root sequence. The formatter now distinguishes EOF root flow
collections from block values and prints the raw YAML line with the SDK's line,
UTF-16 column and caret context. Four failing core cases now pass; six native
SDK comparisons cover sequence/map roots and block values, multiline EOF and
an astral key. Existing document diagnostic offsets remain unchanged. The
frontmatter package's Rust/native/oracle/type routes and lint pass, with the
11-workspace uncached build covering its consuming resolver addon. This fixes
these EOF diagnostics only; general YAML diagnostic/recovery parity remains open.
Evidence: `out/rust-frontmatter-flow-pretty-*`.

### Native resolver document admission optimization, 2026-09-20

Removed full admitted-tree JS round trips from async resolution. Rust invokes
its document parser directly, retains the owned tree, and registers temporal
allocation metadata with Node in one call when needed. Date aliases remain
identical within their document and host formatting still supplies date-valued
keys. Error-only admission uses the existing own Node adapter to preserve JSON
diagnostics and frontmatter classes. A failing native test blocked the former
full-tree parse callback; it now passes with direct native admission and Date
alias checks. Unresolved !!js/symbol tags retain the SDK's scalar string value.

36 Rust groups,19 native groups, all117 actual SDK cases, strict types, package
fmt/clippy and the11-workspace uncached build pass. New comparisons cover date
keys, frontmatter error classes and exact JSON diagnostics. Packed direct
admission and packed two4MiB workers pass with bare imports blocked; temporary
packed assets are purged. Evidence is `out/rust-config-extends-direct-admission-*`.

Fresh native fixture measurements improve resolver96.4–107.1us→65.3–72.8us and
rooted prompt155.1–166.1us→108.5–118.0us. The earlier fresh SDK reference measured
45.0–62.1us/94.8–101.0us, so speed remains below the SDK on these inputs. After4096
additional cycles of each, RSS66.4→68.3MiB/heap4.63→4.65MiB. A separate524,288-cycle
resolver run with GC/idle readings each65,536 cycles fluctuatesRSS52.8–70.2MiB,
ending53.5MiB, while heap remains4.56–4.58MiB. This fixture shows no sustained RSS
or heap growth across the sampled run; it is not a general leak-free guarantee.
Document/base metadata accessors, full YAML fidelity, cross-platform packaging,
remaining MCP applications and the complete poe-agent closure are still open.

### Declarative agent hook descriptors, 2026-09-20

Added optional object-valued `hook_config` descriptors to the Rust agent catalog
and the existing Claude Code/Codex definition files. Hook packages can derive
support, paths, event/handler matrices and placeholder rules from one agent file,
without provider-specific policy branches or a second registry. Public SDK agent
metadata and original TS definitions remain unchanged. A failing Rust catalog
test reproduced the absent field; built-in descriptor ownership, optional custom
configuration and malformed descriptor admission now pass. Maintained agent-defs
unit/lint/type/oracle routes pass (six native groups and63 actual SDK cases), and
the12-workspace uncached agent-mcp-config build closure passes. This is a reusable
prerequisite for agent-hook-config-rust, not a completed hook bridge rewrite.
Evidence is `out/rust-agent-defs-hook-*`.

### Portable agent-hook-config core, 2026-09-20

Started `agent-hook-config-rust` as a Rust-only additive crate. Its catalog derives
hook configuration from agent-defs descriptors. Rust owns event/handler mapping,
placeholder rewrites, drop order and source indexes, stable generated IDs, portable
home/scope plans, parsed-record admission, fully-generated-file ownership checks
and generated-handler mutation. Unknown fields and user handler order are retained;
missing/empty matchers remain distinct, and malformed existing groups precede
incoming marker/finite-timeout validation. Platform I/O hosts execute Rust read
and atomic-write decisions: final symlink refusal, user-before-project scopes,
own missing/collision classification, exclusive temporary retries, partial-write/
rename cleanup, preserved targets on failure and JS numeric-key file formatting.

TDD red/green evidence covers absent core APIs, case-insensitive alias mapping,
missing I/O policies and a reproduced numeric-key text-order mismatch.13 Rust
groups pass, including128 generated SDK transform cases and64 SDK read/mutation
fixtures against memfs. No unit fixture writes to disk. Cargo fmt/clippy with
warnings denied and the locked release core build pass. The own std-only core adds
no external Rust runtime dependency; no npm adapter or production import is wired.
Native bindings, symlink strategy, run ownership/cleanup, malformed-input parity,
performance/memory evidence and complete package acceptance are still pending.
Evidence is `out/rust-agent-hook-*`; the larger goal and24-hour requirement remain
unfinished. The goal tool's blocked status still freezes its50,023-second effort
counter; separately resumed coding has continued since2026-09-20 18:44:42 UTC.

### Hook native transformation and file API subset — 2026-09-20

Added a private independent `@poe-code/agent-hook-config-rust` npm workspace with
one napi-rs addon, own snapshot transport and builtin path/filesystem adapters.
The catalog, pairs, mappings, transformations and read/write APIs have compatible
TypeScript declarations. Filesystem errors preserve original Node exception
identity, own ENOENT/EEXIST classification, and builtin JSON SyntaxError causes.
Drops preserve original source references. Additional red/green native coverage
caught and fixed explicit null versus absent read matcher conversion.

Validation:13 Rust groups,3 native groups, all75 existing SDK cases for the five
implemented modules, strict bidirectional type assignability, fmt/clippy warnings
denied, and the uncached maintained14-workspace build closure. Direct and packed
imports succeed in4MiB workers with external imports blocked, each4096 transform
and support calls. The packed manifest has no runtime/peer/optional dependencies
and exactly one addon. Evidence: `out/rust-agent-hook-native-*`,
`out/rust-agent-hook-read-null-red.log`, and `out/rust-agent-hook-worker-check.json`.

Initial32-entry Node transform measurements:114.3–133.4µs native versus12.0–12.3µs
SDK. The adapter is slower and has no performance acceptance claim. After262,144
additional transforms, sampled RSS94.4→95.3MB and heap9.51→9.53MB with explicit GC;
no sustained sampled growth after stabilization. This is bounded evidence only.
Symlink/bridge/ownership cleanup, full malformed/accessor stages, cross-platform
artifacts, the overall rewrite and minimum24-hour effort remain unfinished.


## Sources

### Hook transform transfer refinement — 2026-09-20

The own addon now serializes transform results once instead of creating every
nested Node value through napi. Builtin JSON admission allocates the Node result;
nonfinite/negative-zero timeout transfer markers are restored explicitly. Added
UTF16/NUL/astral text, ignored Symbol metadata and all timeout-number tests;
negative-zero coverage caught an intermediate codec regression and now passes.
All75 SDK cases and4 native groups remain green. Three fresh32-entry samples are
104.9–107.2µs native versus10.9–12.6µs SDK, improved from the earlier114.3–133.4µs
native range but still much slower. This is an optimization, not performance
acceptance. Evidence: `out/rust-agent-hook-json-transfer-*`.


### Hook symlink bridge — 2026-09-20

Added Rust `links` policies and native `symlinkHooks`. Platform hosts supply only
path/filesystem facts; Rust decides same-format admission, scope, parent traversal,
matching-link idempotence, stale-link replacement and generated-file ownership.
User-authored files receive compatible UserError recovery guidance and own error
code. Generated files are restored exclusively when parent preparation or symlink
creation fails; occupied restoration paths preserve both original exceptions in
AggregateError. Parents are checked again after mkdir and before restoration.

Added three failing-first in-memory Rust groups. All94 existing SDK cases now
pass, including19 symlink/path-safety cases with mocked custom descriptor entries,
recreated-file rollback failures and inherited error-code attacks. Four native
groups and16 Rust groups pass; strict root API assignability and fmt/clippy pass.
Own user-error constants are linked into the single addon, not imported as an npm
runtime dependency. Hook ownership/cleanup and the skill/git-exclude prerequisite
remain unfinished. Evidence: `out/rust-agent-hook-links-*`.


### Skill descriptors from declarative agent definitions — 2026-09-20

Extended the own agent catalog with optional `skill_config` object descriptors.
The six supported agents derive skill directories and the Goose convention note
from their existing single definition files, with no agent-id policy branches.
Public agent metadata remains SDK-identical; invalid custom descriptor arrays
are rejected. Failing-first catalog coverage, six native groups, all63 SDK cases,
strict API types, fmt/clippy and the uncached15-workspace hook consumer build
closure pass. This is the skill rewrite prerequisite, not completed skill APIs.
Evidence: `out/rust-agent-defs-skill-*`.


### Skill catalog, resolution and Git exclude subset — 2026-09-20

Added independent `agent-skill-config-rust` core and private npm workspace. The
catalog uses the declarative skill descriptors; Rust owns alias support, home/scope
plans, ordered reference admission and project-before-user lookup. Git exclude
policies retain existing lines, allocate independent same-run ownership IDs,
remove only complete matching marker blocks and atomically update files with
symlink traversal checks, exclusive temp creation and selective cleanup.

Validation:7 Rust groups including128 generated SDK in-memory block lifecycles
and catalog comparisons,1 native group, all49 existing SDK resolver/exclude cases,
strict bidirectional root API types, fmt/clippy, and the uncached maintained
11-workspace build closure. Direct/packed4MiB workers each run4096 catalog/path/
missing-reference cycles with external imports blocked. Packed artifacts have
exactly one addon and zero runtime/peer/optional dependency groups.

Three missing-prefixed-lookup samples:14.3–14.6µs native versus8.3–9.1µs SDK. After
131,072 additional lookups, sampled RSS85.2→85.7MB and heap9.14→9.17MB with explicit
GC, stabilizing after65,536 cycles. No performance acceptance or general leak-free
claim. Evidence: `out/rust-agent-skill-*`. Configure/install/templates and active
skill lifecycle APIs remain unfinished, as do hook lifecycle cleanup, the overall
rewrite and minimum24-hour requirement.


### Skill filesystem error realm admission — 2026-09-20

Additional failing-first native tests found plain objects, coded functions and
foreign-realm Error objects were incorrectly admitted as missing files by the
new host adapter. It now matches SDK `instanceof Error` plus own-code admission;
other thrown values preserve identity and never silently fall back. Both native
groups, all49 SDK cases,7 Rust groups, fmt/clippy and the uncached11-workspace
build closure pass. Evidence: `out/rust-agent-skill-error-realm-*`.


### Native hook lifecycle and memory isolation — 2026-09-20

Added portable Rust ownership, prior-group tracking, automatic bridge strategies,
overlapping runs, rollback and selective cleanup. The existing single addon links
the own skill exclude core; Node retains hidden manifest state in a WeakMap and
supplies filesystem primitives. Callback reentry is rejected through RefCell
admission before mutable state access. A failing-first preparation test caught
ownership retained after transformation/parent-inspection errors and now passes.
The hook host also retains plain coded objects and foreign-realm errors.

All121 current SDK cases,19 Rust groups and8 native groups pass, including32
comparative overlapping lifecycle rounds with exact in-memory file bytes, strict
full SDK root assignability, fmt/clippy and the uncached16-workspace build closure.
Direct and packed4MiB workers each pass512 overlapping pairs with external imports
blocked; the packed artifact has one addon and zero npm runtime/peer/optional
dependency groups. Overlapping-created empty groups can remain after cleanup,
matching the SDK; no unrelated user configuration is deleted to hide this.

The original persistent-memfs8192-pair samples grew for both APIs. Investigation
found memfs rename overwrites its child link without releasing the old inode;
each1024 pairs retained8193 additional inodes. Resetting fixture history returns
both heaps and buffers to warmed levels. A separate development-only replacement
host that releases replaced fixture inodes keeps9 live inodes: native heap6.84MB
after1024 pairs to6.94MB after8192, arrayBuffers66KB throughout; SDK11.13MB to11.46MB,
also66KB. Native RSS rises70.94MB to81.82MB; SDK90.59MB to92.82MB. Allocator residency
and these bounded sampled workloads do not establish general memory acceptance.
Evidence: `out/rust-agent-hook-bridge-*` and `out/rust-hook-memory-*`.

The overall rewrite, malformed/getter-stage fidelity, broad performance/platform
acceptance and minimum24-hour actual effort requirement remain unfinished.

### Skill configuration, named installation and templates — 2026-09-20

Added portable request machines for supported-agent admission, scope defaults,
skill-name validation, conflict checks, bundled-content comparison, force handling
and mutation plans. Rust template discovery walks package roots and tries source,
distribution and legacy skill locations in SDK order. Node executes async injected
filesystem requests and supplies mutation observers; its existing single addon
statically links the own config mutation and template engines. The two bundled
markdown files are own copies, included both in Rust and packed Node artifacts.

Failing-first core/native/discovery evidence preceded implementation. All13 Rust
groups,4 native groups,50 current SDK resolver/exclude/template cases, strict subset
API type assignment, fmt/clippy and the uncached13-workspace build closure pass.
The comparative native test covers all6 agents ×2 scopes ×2 dry-run states with
exact filesystem bytes, returned paths and observer events through configure,
install and unconfigure. It also tests user-file preservation, unsupported errors,
invalid names and original filesystem exception identity. The source template
oracle adapter preserves its original import-meta location for its memfs fixture.

Direct and packed16MiB workers each pass1024 configuration/install/unconfigure
cycles with external imports blocked.4MiB and8MiB worker limits terminate from
heap exhaustion; those are failures, not low-memory acceptance. The packed package
has one addon and zero npm runtime/peer/optional dependency groups.

Three512-cycle samples are188.6–232.2µs native versus102.6–119.2µs SDK. Additional
8192 cycles keep9 live fixture inodes: native sampled heap7.35→7.68MB and buffers
65.8KB throughout, SDK10.95→11.37MB and73.97KB. RSS ends93.14MB native versus92.83MB
SDK; lower native heap does not establish lower total memory. Evidence:
`out/rust-agent-skill-apply-*`. Active skill lifecycle, complete package acceptance,
the overall rewrite and minimum24-hour actual effort remain unfinished.

### Fixed-memory incremental SHA-256 prerequisite — 2026-09-20

Added an own `Sha256` streaming digest alongside the existing one-shot API for
the upcoming skill-tree fingerprints. It keeps one64-byte tail and does not
concatenate whole directories before hashing. Failing-first vectors cross-check
Node builtin crypto at15 padding/input boundaries and8 chunk widths, including
empty updates. The maintained OAuth unit route passes all56 native and153 SDK
cases plus Rust groups and strict types; fmt/clippy and the uncached8-workspace
build closure pass. Existing OAuth public behavior remains unchanged. Evidence:
`out/rust-sha256-stream-*`. This is a prerequisite, not active skill completion.

### Native active skill bridge and cleanup — 2026-09-20

Added Rust batch resolution admission, grouped user errors, collision precedence,
recursive copy policies, owned SHA-256 tree fingerprints, overlap reference counts,
token checks, rollback and selective parent cleanup. Native bytes cross directly
as Buffers instead of JSON number arrays; only metadata uses JSON callback transfer.
The same single addon links own standard-library/path cores. Node keeps original
manifest cleanup state in a WeakMap, retains serialized duplicate-run exclude IDs,
and supplies builtin filesystem/path/UUID/Git primitives. RefCell admission rejects
filesystem callback reentry before mutable Rust state access.

Failing-first SDK API tests preceded implementation. All137 current source SDK
cases across5 modules,13 Rust groups and8 native groups pass, including32 generated
comparative nested-binary overlap rounds and exact manifests/exclude/final bytes.
Strict bidirectional full root SDK assignment, fmt/clippy and the uncached maintained
18-workspace closure pass. Additional failing-first copy-error tests caught eager
error-code getter evaluation in unrelated host operations: codes are now inspected
only for the relevant primitive's admitted conditions and getter failures retain
their own original thrown values. Raw fingerprint reads never inspect codes.

Direct/packed16MiB workers each pass512 overlapping pairs with external imports
blocked, exactly one addon and zero npm runtime/peer/optional dependency groups.
The native4KiB asset workload samples886.4–992.9µs per overlap pair versus585.9–649.8µs
SDK. A second memfs retention defect emerged: rm/rmdir detach links without freeing
their inodes. Both original fixture runs retain8 orphan inodes per pair and grow
similarly. Releasing only unreachable development fixture inodes at each sample
leaves12 live inodes while the addon stays live across8192 pairs: native heap7.37→7.54MB
and buffers69.9KB, SDK11.16→11.54MB and69.9KB. Final RSS110.85MB native/120.05MB SDK.
These bounded comparisons do not establish broad speed or memory acceptance.
Evidence: `out/rust-agent-skill-lifecycle-*`.

Current root APIs are implemented; malformed/getter-stage, recursive workload
limits, cross-platform packaging and broad acceptance remain unfinished, along
with the overall rewrite and minimum24-hour actual effort requirement.

### Process runner native host subset — 2026-09-20

Added private `process-runner-rust` with a dependency-free Rust core and one addon.
Rust handles active-run stdio/group plans, exactly-once result settlement, Unix
group signal targets and lazy shell fallback selection. The Node transport uses
only builtin child processes and retains stream, signal and environment identity;
it ignores inherited options and supplies null-prototype spawn options.

All25 current SDK host/host-environment cases,3 Rust groups,4 native groups,
strict bidirectional subset API types, fmt/clippy and the uncached5-workspace
build closure pass. Real deterministic subprocess checks cover binary-to-text
UTF8 stream content, stderr, explicit environments, nonzero exits, ordinary/group
signals and cancellation. Additional failing-first native cases caught unused
shell getter reads and premature NAPI validation of malformed unused stdio for
pre-aborted runs. Rust requests fallback facts lazily and original getter errors
retain identity; pre-aborted transport admission avoids the unused native call.
The initial Rust test draft needed a syntax correction; its first recorded red
log is a syntax error, not behavioral red evidence. SDK API-absence and the two
native compatibility regressions provide the concrete failing evidence.

Direct/packed8MiB workers each pass4096 pre-aborted admissions and16 real stream/
exit runs with external imports blocked.4MiB workers exhaust their heap; no4MiB
acceptance is claimed. The packed package has one addon and zero npm runtime/peer/
optional dependency groups. After eliminating unused transport work, three8192-
admission samples are0.106–0.196µs own versus0.187–0.396µs SDK; the own fast path
does not call Rust and is not evidence of a Rust computation speedup.262,144
additional admissions keep sampled heap near4.04MB and buffers10.5KB. Evidence:
`out/rust-process-host-*`.

Docker/mock/workspace-transfer APIs, full host malformed/getter fidelity, Python
bindings, cross-platform artifacts and the larger goal remain unfinished.

### Process runner Docker policies and hook lock correction — 2026-09-20

The process core now uses std and the own JSON core for Docker argument ordering,
port checks, UTF-16 environment-file serialization, lazy engine probing and
Colima discovery. Root context/engine APIs match the current SDK signatures.
Values stay outside argv; first running-profile discovery short-circuits later
malformed lines. Nullish/empty name precedence and JavaScript trim units are
covered. SDK failures caught null-context DTO normalization; an additional
failing-first check caught unused empty-environment env-file getter reads.

All64 SDK host/helper cases,6 Rust groups and7 native groups pass, including64
generated Unicode/flag/port comparisons and exact validation-message checks.
Fmt/clippy denied warnings and the maintained uncached5-workspace build pass.
Direct/packed8MiB workers each run8192 Docker-policy cycles plus4096 pre-aborts
and16 real host children with external imports blocked. One addon and zero npm
runtime/peer/optional dependency groups remain. Across262,144 further policy
cycles, native heap4.11→4.14MB and buffers10.5KB; SDK4.05→4.08MB and10.5KB.
Cycle speed is5.18–5.20µs native versus0.54–1.00µs SDK, so this small workload
is slower through the binding. Evidence: `out/rust-process-docker-*`.

Release804351ea failed because the hook core/binding lockfiles did not include
the skill core's new own SHA dependency. Updated only those two lockfiles and
pushed `caa5cf3af`; remote ancestry is verified. Hook121 SDK cases, native/Rust
groups, lint and maintained build pass, followed by an explicitly uncached build
verification. Earlier build invocations used the maintained route's default
cache; the latter checks explicitly disable it. Release publication is pending.

Docker-runner/environment, mock and workspace-transfer behavior, full malformed/
getter-stage fidelity, cross-platform binaries and overall acceptance remain
unfinished. The24-hour actual-effort requirement remains unfinished.

### Process runner native Docker runner — 2026-09-20

Added the root Docker runner, preserving foreground runs, stream identity,
Docker/Podman context rules, container controls and pre-aborted admission. Rust
owns codepoint-correct ASCII container names, interactive stdio planning, control
argv, abort result override and exactly-once settlement. Node owns builtin
processes/signals/timers and private mode0600 environment-file transport.
Settled runs clear timers/listeners/files; abort schedules10s SIGTERM then5s
SIGKILL. Own argument-validation failure also cleans the allocated environment
file; original production implementations remain unchanged.

Failing-first Rust/module-absence checks precede implementation. All83 actual
SDK cases across4 modules plus3 additional deterministic lifecycle cases pass,
alongside9 Rust groups,7 native groups, strict subset API types, fmt/clippy and
uncached5-workspace build. All maintained filesystem fixtures now use memfs;
the initial SDK runner run preceded that interception and cleaned its temporary
file. Extra cases check exact stream identities, cleanup/listener count, canceled
escalation, late close/error events and contained control transport failures.

Direct/packed8MiB workers each pass2048 simulated Docker runs,8192 policy cycles,
4096 pre-aborts and16 real host children with external imports blocked. One addon
and zero npm runtime/peer/optional dependencies remain. Simulated subprocess/
abort workload speed is6.40–9.34µs native versus2.58–5.65µs SDK. Across65,536 more
runs, sampled native heap4.99→5.09MB and buffers16.6KB; SDK4.97→5.05MB and16.6KB.
These are deterministic transport checks, not real-engine or broad performance
acceptance. Evidence: `out/rust-process-docker-run-*`.

Detached Docker environments/build contexts, mock/workspace transfer, real-engine
acceptance, malformed/getter fidelity and the overall goal remain unfinished.

### Process runner native mock lifecycle — 2026-09-20

Added both root mock APIs with own Rust FIFO indices, completion-delay validation,
exactly-once run/stream lifecycle and UTF-16 missing-command errors. The Node
transport retains behavior objects, builtin streams and timer scheduling, reads
the live exit code only on first settlement, preserves shallow-copy/live-command
lookup semantics and ignores inherited command entries.

Failing-first Rust/module-absence checks precede implementation. All97 actual
SDK cases across5 modules plus3 additional Docker cases,12 Rust groups,9 native
groups, strict subset types, fmt/clippy and uncached5-workspace build pass. Extra
native cases cover failed FIFO slots, live command mutation, repeated kill,
exit-code getter counts, piped stdin and Unicode stream bytes.

A memory comparison caught consumed-slot retention before commit: all64 behavior
objects/32MiB payload buffers remained live in the initial native queue, while
the SDK released them. Clearing each consumed slot fixes this: native and SDK
retain0 objects and return to10.5KB buffers while their runner stays alive.
Direct/packed8MiB workers each pass4096 mock replays and64 output runs, alongside
the earlier process workloads, with external imports blocked. One addon and zero
npm runtime/peer/optional dependencies remain. Silent runs measure0.91–1.00µs
native versus0.25–0.58µs SDK. Across65,536 more runs, heap3.86→3.88MB native,
3.77→3.80MB SDK and buffers10.5KB each. Evidence: `out/rust-process-mock-*`.

Root Docker environments/build contexts and workspace transfer remain unfinished,
along with real-engine/cross-platform/full malformed acceptance and the larger
rewrite/24-hour actual-effort requirement. The hook-lock correction's Linux
release build and audit have passed; full publication is still pending.

### Process runner own build-context filtering — 2026-09-20

Added the root build-context reader and SDK `docker/build-context`/`testing`
subpaths with bidirectional types. An own std Rust matcher replaces the original
reader's runtime ignore dependency. It handles UTF-16 wildcard units, anchoring,
parent-directory exclusion, ordered negation, directory rules, globstars, class
ranges, case folding, escaped markers and whitespace. Dynamic programming avoids
regex/backtracking. Builtin Node filesystem transport preserves bytes/errors,
skips symlinks, always includes `.dockerignore`, and preserves locale sorting.

Failing-first core/addon/module absence, escaped-wildcard comparisons and a
trailing-directory-globstar anchoring case precede their implementation/fixes.
The maintained suite now includes166,991 generated valid-reference comparisons
plus a targeted rule/path matrix. One generated malformed rule is rejected by
the reference library's regex compiler and is explicitly counted separately;
its native SyntaxError parity is not implemented or counted as a comparison pass.
All97 actual SDK cases plus5 additional filesystem/lifecycle cases,15 Rust
groups,11 native groups, strict root/subpath types, fmt/clippy and uncached
5-workspace build pass. Filesystem fixtures use memfs.

Direct/packed8MiB workers each add512 build-context reads to the prior host,
Docker and mock workloads with external imports blocked. One addon and zero npm
runtime/peer/optional dependencies remain. Matcher construction plus12 paths
measures9.76–9.83µs native versus3.89–3.92µs reference. Across131,072 more cycles,
native heap3.84→3.87MB, buffers10.5KB and RSS111.8→112.4MB; reference4.00→4.04MB,
10.5KB and59.9→62.8MB. Native resident usage is higher despite lower sampled JS
heap. No broad performance/memory acceptance follows. Evidence:
`out/rust-process-ignore-*`, `out/rust-process-build-context-*`.

Docker runtime templates/detached environments, workspace transfer, malformed/
getter/SyntaxError parity, real-engine/cross-platform acceptance and the larger
rewrite/24-hour actual-effort requirement remain unfinished. The lock-correction
release build/audit/checks/cached-unit and all4 Bash shards pass; uncached unit
and publication are still pending.

### Process runner deterministic workspace archive prerequisite — 2026-09-20

Added the portable std-only USTAR encoder with borrowed file payloads, deterministic
mode0644/zero ownership/timestamps, checksum,512-byte padding and1024-byte final
tail. UTF-8 byte limits select100-byte leaf/155-byte prefix splits while path
errors preserve original UTF-16 units. Paths are validated before full archive
allocation; checked lengths and fallible reservation avoid overflow/allocation
panics. This is an internal prerequisite, not a completed root transfer API.

Failing-first core/API-absence checks precede implementation. The first native
draft had a computed-key syntax error, corrected before recording the actual
native API-absence red; that syntax error is not behavioral evidence. All97 SDK
cases plus5 additional cases,18 Rust groups,12 native groups, strict subset types,
fmt/clippy and uncached5-workspace build pass. SDK upload through memfs produces
byte-identical archive references across six payload padding sizes, binary data
and multibyte path boundaries. Original long/lone-surrogate path errors are checked.

Initial external-buffer outputs retained high resident allocator usage after
warmup despite live buffers returning to baseline. Switching this binding's
output to `BufferSlice::copy_from` and immediate Node Buffer conversion avoids
that external output allocation. Live input DTO Buffer references remain scoped
to the synchronous call; no JS callback occurs while payload slices are borrowed.
No external registry source was edited. RSS samples improve from252.5→247.0MB
for the former route to82.3→83.6MB for Node-owned output across131,072 further
encodes. Sampled heap3.66→3.69MB, buffers14.6KB and external1.47MB stay steady.

For two entries/6656-byte output, final native speed1.77–2.12µs versus9.30–10.20µs
SDK. The private SDK encoder is extracted with the development TypeScript AST
compiler into `/out` for a fair encoder-only comparison; the production package
does not import it. SDK RSS57.7→57.9MB, heap3.81→3.84MB and buffers22.8KB.
Direct/packed8MiB workers each add4096 archive encodes and invalid-path checks
to the earlier process workloads with external imports blocked. One addon and
zero npm runtime/peer/optional dependency groups remain. Evidence:
`out/rust-process-tar-*`.

Upload/download state machines and Docker runtime/detached environments remain
unfinished, together with real-engine/cross-platform/malformed acceptance and
the larger rewrite/24-hour actual-effort requirement. The lock correction's
uncached release unit and publication remain pending.

### Process runner workspace transfer policies — 2026-09-20

Added root upload/download APIs without changing existing TypeScript integration.
Portable Rust owns resumable staging/promotion/rollback effects and exception
priority, ordered workspace ignore rules, borrowed SHA hashing, stable hash/path
state, conflict detection and deletion candidates. Workspace patterns deliberately
use the SDK dialect (case-sensitive, segment globstars, literal question marks and
classes), independently of Docker build-context ignore. Node executes filesystem
effects and retains payload bytes; native controllers retain no host callbacks or
buffers. Download traversal, link checks and atomic write sequencing remain Node
transport and are candidates for portable controllers.

Failing-first core/addon/API absence and an embedded-LF exclusion discrepancy
precede implementation/fix. All103 SDK cases plus5 lifecycle/context cases,28 Rust
groups and17 native groups pass, along with strict types, fmt/clippy and the
maintained uncached10-workspace build closure. Sixteen generated comparative
transfer rounds verify exact archives/files, size warnings, filters, conflict
refusal/overwrite and deletion. Six injected upload failures compare rollback
contents and original exception identity. Symlinks and missing link-check support
are covered with memfs. An8MiB Rust hash allocation contract passed with the
existing fixed-stack SHA tail; no SHA payload-copy bug or change is claimed.

Direct and packed16MiB workers pass256 transfers plus context/tar/mock/host/Docker
policy workloads with production external imports blocked. The dev filesystem is
loaded before blocking.8MiB workers fail heap exhaustion. One addon and no npm
runtime/peer/optional dependencies remain. Transfer pairs measure247.7–321.1µs
native versus238.9–443.3µs SDK. Across4096 extra pairs, sampled native heap
6.86→7.17MB, SDK6.98→7.40MB; buffers74KB each and final RSS119.9/119.6MB.
Only unreachable dev memfs inodes are released at checkpoints; environment state
remains alive. No broad speed or total-memory acceptance follows. Evidence:
`out/rust-process-workspace-*`.

Docker runtime templates/detached environments, full malformed/getter and
real-engine/cross-platform acceptance, the remaining MCP/agent packages and
24-hour actual effort remain unfinished. Lock-correction release build, audit,
checks, cached-unit and Bash shards pass; uncached unit/publication still pending.

### Process runner Docker runtime templates — 2026-09-20

Added root `buildDockerRuntimeTemplate` with portable own content hashing, cache
admission, canonical-relative containment and sorted build argv policies. Own
streamed SHA hashes Dockerfile, engine, filtered context files and development
host locale-sorted argument pairs with exact SDK delimiters/UTF-16 replacement.
Only hash state remains in the controller; payload buffers are borrowed for the
synchronous call. Node resolves canonical paths, executes processes and calls
the supplied cache. No external runtime dependencies or TS implementation imports.

Failing-first core/addon/module tests precede implementation. The initial drafted
expected hash was corrected from a directly computed development Node reference
before the core existed; it is not a behavioral regression. Three Rust groups,
128 generated native reference comparisons and five memfs transport cases cover
engine keys, binary/UTF-16 hashes, context exclusion, sorted args, missing cached
images, force, canonical outside paths and failed-build cache refusal. All103 SDK
cases plus10 own Vitest cases,31 Rust groups,18 native groups, strict subset types
and denied-warning fmt/clippy pass. Maintained uncached10-workspace closure passes.
An initial private binding module caused denied dead-code warning; publishing
the binding module fixes it without suppressions.

Direct and packed16MiB workers add64 Docker template builds each to the previous
workloads with external production imports blocked. One addon, zero npm runtime/
peer/optional groups. Portable scalar SHA is materially slower than Node crypto:
4KiB12–14µs versus2.1–2.2µs,64KiB150–179µs versus22–24µs. Across32,768 extra
hashes, native heap4.12→4.15MB with steady buffers;4KiB RSS58.8→58.9MB,64KiB
54.3→55.9MB. Reference heap4.18→4.20MB,4KiB RSS56.8→57.1MB,64KiB56.9→57.6MB.
Both measurement processes load the addon for consistent baseline. Hardware
acceleration/broad performance acceptance remain unfinished. Evidence:
`out/rust-process-template-*`.

Docker detached environments, full malformed/getter/real-engine/cross-platform
acceptance, remaining MCP/agent closure and24-hour effort remain unfinished.
Remote transfer delivery verified as `e71f18764`; successful publication is not
yet verified.

### Process runner persistent Docker environments — 2026-09-20

Added root persistent environments and detached job APIs. Portable Rust owns
exec/status/wait/control/close/log command plans, UTF-16 shell quoting, strict
complete safe decimal exit codes, UTF-8 complete-prefix boundaries and resumable
follow/final-read decisions. Node owns asynchronous process/stream/signal I/O,
secure temporary filesystem transport, container file traversal, sync configuration
adaptation and timers. Transport was derived from SDK source with development
TypeScript AST tools and adapted to own Rust policies/own host modules; production
does not import the SDK. This is not a claim that all lifecycle/transport code is
Rust. Docker shell defaults/configuration validation have remaining portability
refinement alongside malformed/getter fidelity.

Failing-first core/API absence and57 actual SDK cases precede implementation.
The first run catches a timer import elided by development transpilation before
the Rust-policy transport was appended; the explicit builtin import fixes follow
polling. One new native DTO assertion incorrectly expected an own undefined
optional property; the test now expects the declared omitted-field shape, with
no production behavior change. A struct refactor had a draft syntax error fixed
before final validation. All160 actual SDK cases plus10 own Vitest cases,34 Rust
groups and20 native groups pass; strict full-root/subpath bidirectional types,
fmt/clippy with denied warnings and maintained uncached10-workspace build pass.
All14 SDK root runtime exports now exist.8,192 generated byte sequences and
private actual SDK functions check boundaries, wait parsing and quoting; malformed
decimals, split characters, abort/follow/final-read and persisted contexts are
covered. Filesystem fixtures remain in memory. No real Docker engine acceptance.

Direct and packed16MiB workers add512 simulated persistent environment cycles
and one reattach each to prior workloads with external imports blocked. One addon
and zero npm runtime/peer/optional groups remain. Initial8,192-cycle RSS growth
prompted an extended32,768-cycle comparison: native31–47µs/cycle versus21–38µs
SDK. Resident usage levels off after warmup near133–137MB native/130–137MB SDK;
final sampled heap4.73/4.92MB, buffers24.8KB each. Earlier short-run timings
36–58µs versus27–49µs are retained as evidence, not excluded. No real-engine or
general speed/memory win follows. Evidence: `out/rust-process-environment-*`.

Full malformed/getter/cross-platform/real-engine/performance acceptance, more
portable download/shell/container-filesystem controllers, remaining MCP/agent
closure and24-hour effort remain unfinished. Remote Docker-template delivery
verified as `9ad78d736`; release publication still unverified.

### Process runner root test registration correction — 2026-09-20

Release35544228030 validates a root/shared discovery failure: own three filesystem
test modules also run from root without the package-only setupFiles entry, so they
reach real files instead of memfs. Local root config reproduces the eight failures
(symlink/read fixtures, canonical paths and temporary-file cleanup). Each module
now explicitly imports its own memfs setup. No root membership/workflow or shared
runner logic changes. Focused root discovery passes all10 own cases and maintained
process-runner-rust unit passes170 Vitest/34 Rust/20 native groups; existing files
remain preserved. Evidence: `out/rust-process-root-registration-*`.

Lock-correction Release35541696723 completed all validation gates successfully.
Its semantic publisher explicitly skipped a new version because remote main had
advanced; successful workflow is not successful publication. The newer template
release failed root unit before this correction. Publication remains unverified.
The overall additive rewrite and minimum24-hour effort remain unfinished.

### Own OAuth test-server prerequisite — 2026-09-20

Added `tiny-oauth-test-server-rust`, private/suffixed, with own std/path-core grant
state and one napi-rs addon. Rust owns configuration/admission, DCR metadata,
loopback redirect and duplicate-param policy, consent decisions, single-use codes,
PKCE/verifier replay, refresh rotation/expiry, explicit revocation, listener
admission/reset, endpoint/metadata/claims/response/HTML/redaction plans and CLI
values/output. Node supplies canonical WHATWG URL facts, builtin HTTP/entropy/key
operations, asynchronous signatures, request logging and transport cleanup.
No runtime TypeScript/SDK fallback. Existing imports/defaults/releases untouched.
Core remains portable for future host/Python bindings; Python bindings not added.

Failing-first core/addon/module, response/priority, redaction, CLI and listener
absence precede implementation. The SDK catches non-finite JSON values collapsing
to null/default; the transport now preserves markers so Rust rejects them. Own
comparisons catch live default-scope array mutation loss and missing RSA2048-bit
minimum; captured array identity is observed at admission, and Rust signing facts
produce the SDK TypeError for undersized RSA. Root direct URL/TTL validation
priority and the empty-resource URL diagnostic had failing evidence and were corrected. Static clients retain precedence
over colliding dynamic IDs in separate registries. No access-token record reader
exists in the SDK; omitting those private duplicate records preserves public
revocation behavior and reduces retention. Other observable histories remain.
A missing binding JSON dependency and an empty native-test list causing Node
autodiscovery of a Vitest file were tooling failures, fixed before delivery.

All48 SDK root cases,4 CLI cases (only expected package-name literals adapted to
the required suffix),5 own Vitest cases,8 Rust groups,3 native groups, strict
bidirectional root/CLI types, fmt/clippy with denied warnings and maintained
uncached11-workspace closure pass.104 declared workspaces/301 dependency edges.
Filesystem fixtures are in memory; no models queried. Direct/packed16MiB workers
each verify64 real localhost HTTP listener cycles,1024 direct signatures/revokes,
64 code exchanges/replay checks,4096 unavailable-issuer admissions and CLI help
with external production imports blocked. Exactly one addon and no npm runtime,
peer or optional dependency groups.

Measured direct-token calls81–89µs native versus73–83µs SDK. Across16,384 extra
calls with the same seeded P-256 key and fixture alive, native sampled heap
6.40→6.47MB, SDK9.52→20.25MB; buffers76.2KB each, final RSS94.0/110.0MB. This
shows bounded retention benefit from omitted unobservable token copies, without
a general performance/memory acceptance. The final portable listener additions
were independently verified after this token-only measurement; token policy did
not change. Evidence: `out/rust-oauth-fixture-*`.

Help/error screenshots inspected: readable suffix, aligned options and clear
invalid-port error plus help. `screenshot-poe-code` hardcodes the main CLI and its
predev full build fails in safe-bash-playground; the maintained generic screenshot
harness directly captures this package's built CLI instead. The root predev
failure was not counted as a screenshot or successful build. The actual plan
continues to require the MCP OAuth fixture, terminal MCP renderers and agent
closure, malformed/getter/cross-platform/aggregate/performance acceptance and
24-hour actual effort. Release6a082b4c6 is pending; successful publication remains
unverified.

### MCP HTTP binding embeddability — 2026-09-21

Embedding the existing own HTTP binding in another single-addon fixture reproduced
an unused private-import warning under denied warnings. Re-exported the existing
native response-message type so the parent crate can use that binding's alias.
No runtime behavior or TypeScript imports change. The maintained HTTP package's
443 Vitest cases,48 native groups, Rust groups and lint pass. The new fixture's
native tests independently exercise the combined artifact; implementation remains
additive and the overall rewrite remains incomplete.

### Own HTTP MCP OAuth fixture — 2026-09-21

Added private `tiny-http-mcp-oauth-test-server-rust` with one combined napi-rs
artifact and embedded own Rust-family HTTP/client/OAuth adapters. Zero npm runtime,
peer or optional dependency groups. Rust owns option normalization/diagnostics,
scopes/TTL/path/issuer/resource validation, pending/active admission, listener
generations, own-code ephemeral retry admission, temporary-port collision rules,
cleanup result priority, revocation rejection and CLI values/output. Existing own
Rust cores implement MCP sessions/tools/auth, JWKS and OAuth grants/replay.
Node performs URL/HTTP/key/signature/reservation/parallel-close transport; no
runtime TypeScript or external SDK delegation. Production imports/defaults remain.

Failing-first core/addon/module absence preceded implementation. A failing core
case refined temporary collision rejection into another reservation rather than
configured-collision failure. Binding embedding reproduced a private-import
warning; the prerequisite's existing type now has a public Rust re-export.
A failing static import-graph check also caught an unused SDK testing adapter and
a client declaration re-export pointing at another npm package. Packaging now
omits unused development testing/CLI adapters and rewrites declarations to own
relative modules, with an AST check over every shipped host/declaration.
Incidental napi acronym naming and mismatched in-memory HTTP registries were
validated tooling errors and corrected. The expiry test initially mocked only
Date.now at verification, whereas the verifier intentionally uses new Date;
the corrected fixture issues an already-expired valid token instead. No expiry
implementation bug was demonstrated or changed.

All 18 actual SDK fixture cases (11 root, 5 CLI, 2 lifecycle),5 own transport cases,
5 Rust groups, 3 native groups and bidirectional root/CLI declaration checks pass.
The SDK lifecycle mocks target the corresponding own adapters; CLI literals use
the required suffix. Own tests include an official SDK client handshake/tools,
revocation, deficient scopes, expired credentials, bootstrap recovery, stable
captured scopes and stale handle protection. Root discovery independently passes
all 5 own cases. SDK filesystem/network fixtures remain in memory; no models.
Maintained uncached 16-workspace closure: 105 workspaces / 307 dependency edges.
The HTTP prerequisite separately passes 443 Vitest cases, 48 native groups, Rust
and lint. Formatting and clippy deny warnings for both new crates.

Direct and packed 16MiB workers each pass 32 real localhost listener cycles,
32 complete discovery/DCR/PKCE flows through the own client,2048 echo calls,
32 direct-token/revocation checks, repeated close and CLI help. Strict production
import guards prohibit external packages. Exactly one addon in the npm archive.
Help and invalid numeric flag screenshots inspected: clear/aligned/readable.
Evidence under `out/rust-mcp-oauth-fixture-*`. Bounded real listener/token timings
initially overlap (native 4.0–5.5ms, SDK 4.8–5.5ms); after 1024 further rounds, sampled
heap 9.88/12.10MB and buffers 76KB each, but RSS 286/213MB. Concurrent sampling and
allocator/GC effects prevent a general speed or memory claim. Extended retention
checks now complete another 8192 actual listener/token rounds per implementation.
Native final sampled heap 17.48MB, SDK 19.92MB; buffers 76.15KB each, RSS
114.08/120.21MB. Final batches level off near those heaps, while initial RSS
388/256MB later decreases sharply. One-second OS process samples confirm active
HTTP/V8 work rather than an idle wait, with peak physical footprints about545MB
for both processes. Timings vary and sampling overlaps; these bounded outcomes do
not establish general throughput or retention acceptance. No dangling listeners
or verification failures observed through all 8192 further rounds.
Aggregate/malformed/getter/cross-platform/performance
acceptance, terminal renderers and the poe-agent closure remain unfinished.

Conservative resumed effort segment 23:10:05–23:49:57 UTC is recorded; compaction
23:49:57–23:54:31 is excluded. Work resumed 23:54:31. The frozen blocked goal tool
counter is not used to imply that 24 hours have been achieved or the goal is done.

### Terminal renderer additive delivery (2026-09-21 UTC)

`terminal-png-rust` now provides the original root API, an additional CLI export,
and a suffixed executable through one napi-rs addon. Own portable Rust owns
UTF-16 ANSI/control cells, Unicode 17 extended graphemes, SVG layout, bundled
JetBrains Mono font faces, bounded TrueType cmap/metrics/simple/composite
outlines, eight-sample antialiased scanline rasterization, fixed-Huffman LZ77
Deflate/PNG encoding, atomic-output admission/cleanup and CLI grammar. Node
supplies filesystem/executable effects; no production SDK/resvg/npm dependency.
The font OFL and Unicode data licenses accompany own assets and generated tables.
Existing TypeScript and production imports/defaults remain intact.

Core/module/addon absence was checked before implementations. All 766 official
Unicode 17 grapheme vectors pass, alongside 4,096 Intl comparisons, 1,024 ANSI
comparisons, exact SVG layout/style/palette comparisons, codec round trips and
bounded font/XML/raster tests. The attempted fractional-rectangle alpha245
expectation was rejected after actual resvg returned255, matching own output;
no product bug was validated there. A selected-workload performance red exposed
37.5–39.5ms Rust captures versus28.0–28.9ms SDK before optimization. Restricting
coverage work to shape horizontal bounds and copying opaque pixels preserves
three clipped/translucent/offscreen raw-pixel SHA256 vectors and SDK pixel checks.

Maintained focused checks pass: 71 applicable SDK Vitest cases, six native groups,
18 Rust tests, strict bidirectional root/CLI types, fmt/clippy for both crates,
and an uncached five-workspace build closure (106 workspaces/309 edges). Two SDK
resvg constructor/options cases are architecture-specific and omitted, not passes;
font exports and actual raster pixels are independently checked. Representative
images share dimensions and mean channel difference below3/255. Native/reference,
help and numeric-error PNG screenshots were visually inspected. Not pixel-identical.

Fresh direct and packed16MiB workers each complete512 captures with actual zlib
PNG decoding and CLI validation, external production imports blocked. AST audit
covers every shipped JS/declaration. Archive has exactly one addon and no npm
runtime/peer/optional groups, with own fonts/licenses. An initial audit passed a
URL to path.join; correcting this evidence script fixed the diagnostic, not product.
An interrupted measurement overlapped a build launch and was discarded; final
measurements used stable built binaries. Own packed artifacts are removed after
verification; evidence remains under out/rust-terminal-png-*.

Extended pre-optimization runs complete2,048 further captures per implementation.
Native RSS settles114.90MB, SDK final1,341.03MB, sampled V8 heap4.85/5.35MB and
buffers16.62KB each. SDK RSS fluctuates1.34–1.35GB in final batches; this is bounded
workload evidence, not a proved leak. Post-optimization selected warmed runs:
Rust29.3–32.4ms, SDK37.7–42.6ms; PNG75,220/55,316 bytes. The selected timing gate
passes, but host load and image differences prevent a general speed claim.

General SVG paths, gradients, clipping/masks/filters, strokes/rounded rectangles,
complex shaping, malformed/getter/cross-platform distribution and aggregate
acceptance remain incomplete. The README explicitly records these limits. This
is an additive terminal implementation delivery, not full package/goal acceptance.
The terminal MCP and poe-agent closure still require further implementations.

### PNG compression refinement (2026-09-21 UTC)

A smaller terminal MCP capture revealed a further speed red:10.4ms Rust versus
5.2ms SDK. PNG row-difference filtering and sparse back-reference insertion
reduced it to7.4ms, still failing. A16-candidate chain budget and a best-match
byte rejection then pass the selected workload gate. Final serial calls:
Rust2.24–2.32ms, SDK5.11–5.36ms. Across1,024 further calls, sampled heap
3.92→3.97MB/6.61→6.70MB, buffers10.48/24.81KB, RSS53.79→88.67/195.77→219.56MB.
This is bounded workload evidence with different image pixels, not broad acceptance.

Codec refinement preserves decoded RGBA across multiple rows/alpha, actual Node
zlib/CRC round trips, existing raw raster hashes and71 applicable SDK cases.
Seven native groups,18 Rust tests, types and fmt/clippy pass; maintained uncached
nine-workspace closure includes the terminal MCP package. Fresh direct/packed
16MiB workers again complete512 captures per artifact. Fast compression trades
size for speed: mixed-option terminal worker bytes increase5,460,224→6,714,752
across512 images; corresponding MCP bytes4,977,024→6,361,984. Each image is valid
and reconstructs all rows. Fixed-Huffman compression tuning remains possible.
Evidence under out/rust-terminal-png-fast-* and rust-terminal-png-mcp-performance-*.

### Terminal PNG MCP additive delivery (2026-09-21 UTC)

`terminal-png-mcp-rust` packages a single addon with own stdio MCP and terminal
Rust cores. The portable tool definition/schema, argument admission, rendering
and CLI grammar are Rust-owned. A libuv AsyncTask computes rendering off the
Node event loop. Node supplies callback/stdio transport, image wrapping and CLI
executable detection, with no external npm runtime imports or SDK delegation.
The tool/server name stays compatible; the executable/package has the Rust suffix.
Existing production imports/defaults/release wiring are preserved.

Failing core/addon absence preceded implementations. Native CLI comparisons
exposed repeated short flags and exact diagnostics, corrected against Node's
actual parseArgs. A strict type red exposed additive own session methods and a
transport overload; AST preparation now omits those declaration extensions from
the compatible public interface. All six original SDK cases pass (one root,
five CLI including real/symlink executable detection), plus three Rust groups,
four native groups, bidirectional root/CLI types and fmt/clippy for both crates.
Official MCP SDK InMemoryTransport discovers and calls the actual own image tool.
Native checks verify asynchronous event-loop progress and eight independent calls.
Maintained uncached nine-workspace closure succeeds; no models/filesystem fixtures.

Fresh direct and packed16MiB workers each complete512 image tool calls, zlib
PNG row decoding, imported/executable help and a real CLI stdio initialize/list/
image-call exchange through EOF. External production imports are blocked in the
workers and every shipped JS/declaration passes an AST import audit. Archive has
one addon and zero runtime/peer/optional dependency groups. Font/Unicode licenses
are included. Help/unknown-option screenshots were inspected and are clear.
Evidence out/rust-terminal-png-mcp-*. Own packaged artifacts removed after checks.

The preceding compression refinement reports final serial selected timings and
1,024 further-call memory evidence. Rendering still inherits the terminal core's
incomplete general SVG/shaping and pixel differences. Full malformed/getter,
cross-platform/aggregate/performance acceptance and the poe-agent closure remain
unfinished. This package delivery does not complete the overall rewrite goal.

### Terminal-pilot primitives and POSIX transport delivery (2026-09-21 UTC)

`terminal-pilot-rust` adds own persistent terminal buffers, frozen screen
snapshots, key encoding and ANSI stripping through a single addon. Rust retains
UTF-16 cells/parser chunks/split surrogates, SGR, cursor/tab/scroll/alternate-screen,
origin/insert/wrap, DEC charsets and portable graphemes. Official Unicode 17
emoji/mark tables support selector/keycap emoji and Indic conjunct widths.
Node supplies public cell views and frozen metadata; returned cell arrays are
snapshots and external mutation cannot modify Rust state. Geometry/CSI/grapheme/
repeat budgets explicitly differ from unbounded pathological SDK behavior.

Core/addon absence reds precede implementation. SDK comparisons expose selector/
keycap and repeat widths, then an additional chunked Indic conjunct red. Own
Unicode tables and mark-aware width calculation resolve those concrete failures.
All198 applicable SDK cases pass (163 control/buffer/screen cases plus35 grapheme
cases), four native display groups, six Rust tests and strict public contracts.
SDK Pilot/Session/public-full-entry tests are omitted, not passes. Buffer's SDK
private fields make nominal class assignment incompatible; mapped public
structural contracts are checked bidirectionally. Root is still incomplete.
Fmt/clippy for both crates and explicit uncached25-workspace build pass:
108 workspaces/317 edges. A separate explicit uncached nine-workspace terminal
MCP build also passes after compression refinement. Earlier default build reports
used shared cache policy with zero hits at initial runs; final routes explicitly
use --no-cache to establish uncached execution.

Own macOS/Linux POSIX transport adopts std File descriptors, uses platform
openpty/setsid/controlling-TTY/ioctl calls, bounded nonblocking queued input,
read/resize/signal/exit, and asynchronous finalizer reaping. Platform C calls are
isolated; pre-exec uses only async-signal-safe calls. A live/unreaped session
leader pins the process-group ID before finalizer group cleanup. Six native
groups include two actual macOS PTY checks for controlling terminal, dimensions,
input/output, resize, SIGTERM and exit7. A separate --expose-gc check terminates
and reaps all32 owned sleep processes. Linux ABI/link support is implemented but
not runtime-verified; Windows and other Unix platforms remain unsupported.

Direct and fresh packed16MiB workers each complete4,096 buffers/screen snapshots,
40,960 mode/style/parser chunks and exact text/hidden-cell metadata checks.
External production imports are blocked, shipped JS/declarations pass AST audit,
archive has one addon and zero runtime/peer/optional npm groups. An evidence
script's literal CRLF initially became invalid worker source, then a normalized
LF gave an invalid cursor expectation. Escaping controls and restoring CRLF fixed
that script; no buffer defect was demonstrated by those two evidence errors.
The inspected terminal core PNG shows readable title/styles/borders/accent,
with missing emoji glyphs visible in the underlying renderer. Full image shaping
acceptance is not achieved. Own packed artifacts are purged after checks.

Selected repeated-buffer memory gate initially fails: native final RSS586.94MB
versus201.33MB, despite faster native buffers. External-memory hints alone still
leave RSS578.21/193.28MB. Pointer-sized empty-cell slots plus dynamic buffer
accounting and immutable screen accounting address the native allocation cost.
Final32,768 further buffers: native RSS113.08→138.90MB (late batches level off),
SDK189.53→195.41MB; heap3.65→2.87/5.15→4.23MB, buffers10.48/16.62KB.
Native16.1–19.4µs/buffer, SDK53.8–61.2µs in the selected warmed workload. The
bounded memory gate passes; no broad memory/performance acceptance implied.
The larger terminal capture after compression now measures11.1–11.3ms versus
28.4–29.9ms SDK, PNG84,988/55,316 bytes; final RSS92.09/638.65MB across512 further
captures. These workloads have the documented pixel/size differences.
Evidence out/rust-terminal-pilot-* and out/rust-terminal-png-*.

CI35549525659 setup fails because an exact dev SDK1.26 pin lacks its nested
lock entry. Reproduced with npm ci --dry-run. Commit ae6be112d aligns the two own
fixture/terminal MCP dev pins to the already-tested locked SDK1.29. Both focused
unit/lint routes pass, and a manifest-only snapshot of tracked remote scope
passes npm ci --dry-run without the unrelated in-progress pilot workspace.
Root lock changes are limited to those two pin values. Subsequent full current
workspace dry-run also includes pilot's own lock/link entries. Release35546033810
validation/release job succeeds, but its log explicitly declines publication
because main is behind remote; no actual new publication verified.

Public PTY sessions, TerminalSession/Pilot orchestration, CLI/commands, pilot MCP,
Python bindings, full malformed/getter/width/cross-platform acceptance and agent
closure remain unfinished. This is an atomic primitives/transport delivery, not
completion of terminal-pilot or the overall goal. Conservative active segment
23:54:31–01:20:00 UTC is recorded. No24-hour effort or goal completion claimed;
work continues beyond this boundary and the frozen blocked counter stays unchanged.

### Terminal session and pilot lifecycle delivery (2026-09-21 UTC)

Own portable Rust Session now retains terminal state/raw history, normalizes
carriage-return/backspace rewrites, validates geometry/timeouts/history/scope,
matches literal lines and owns quiet timing, exit admission and retryable close
escalation (250ms natural grace, SIGTERM1000ms, SIGKILL1000ms). Rust Pilot owns
ordered registration/active retention/removal. Node adapters supply environment,
UTF-8 decoding, PTY polling, timers, event subscriptions and ECMAScript RegExp
evaluation. Production SDK delegation is absent. Public TerminalSession/Pilot
exports and public structural TypeScript contracts are now available.

Five lifecycle/registry Rust absence reds and public export absence red precede
implementation. An additional explicit-disposal red exposes missing native
disposal; optional owned transport state now releases the descriptor immediately,
with idempotent disposal and safe errors on later effects. Eleven Rust tests,
nine native groups,238 applicable original SDK cases and five own Vitest cases
pass (243 total Vitest). Two node-pty spawn-helper filesystem tests are omitted
as incompatible architecture, not counted. Four own cases exercise split UTF-8,
exit-tail draining, Unicode scalar typing/cadence, failure propagation and
shared close/concurrent waits with cleaned timers. Another compares256 generated
16-piece streaming histories/screens with original sessions, including split
controls/surrogates/combining sequences, rewrites, resize and literal/global/
sticky pattern waits. Fmt/clippy, bidirectional public contracts and explicit
uncached25-workspace build pass (108 workspaces/317 edges).

Fresh direct/packed16MiB workers each complete128 real interactive sessions,
concurrent exit waits, frozen styled snapshots and retained closed session
objects. Prior4,096-buffer packed checks still pass, all shipped JS/declaration
imports pass AST audit, package has one addon and zero runtime/peer/optional npm
groups. Selected separate processes with128 further retained macOS sessions:
native mean creation5.98ms/roundtrip37.43ms versus SDK1.57ms/35.60ms. Native
RSS50.41→57.87MB, SDK60.11→65.93MB; native heap4.71→4.97MB versus5.43→6.45MB.
TTY-path descriptors remain0→0 in the native workload versus8→136 in the SDK;
this path-filtered count is not an aggregate descriptor proof. Creation is slower
and deserves a separate spawn-path investigation; no general performance
acceptance claimed. Evidence out/rust-terminal-pilot-session-*.

Raw session history is intentionally retained and unbounded, including after
exit, matching original lifetime semantics; no bounded-history acceptance.
CLI/commands/named runtime/pilot MCP, Linux execution/Windows support, general
width/shaping and the remaining agent closure are unfinished. Inherited latest
commit d61a0142e is verified on origin/main; release remains pending. Earlier
SDK-pin release35550571891 build/audit now pass and unit/Bash stages are running,
with no verified publication. Active segment resumes01:24:12 UTC after the
checkpoint gap. Full goal and24-hour effort remain incomplete.

### Terminal exit-tail regression (2026-09-21 UTC)

A deterministic transport red writes final bytes between an empty PTY read and
the subsequent exit observation: history incorrectly contains only ready rather
than ready/final-tail. Own Node adapter now drains again after reaping, sharing
the same per-poll64-read work budget, before finalizing UTF-8 and publishing exit.
This is a host-effects fix; it does not change Rust lifecycle policy. Full focused
unit route passes244 Vitest (238 original applicable plus six own), eleven Rust
tests and ten native groups in the current tree. Concurrent separate macOS spawn
optimization is still being validated and is not part of this atomic fix.
Evidence out/rust-terminal-pilot-exit-tail-red.log and -unit.log.

### Direct macOS PTY spawn refinement (2026-09-21 UTC)

The selected creation performance gate fails before the change (5.98ms own versus
1.57ms reference). Own Darwin `posix_spawn` now starts absolute commands in the
unchanged current directory with SETSID, closed unrelated descriptors, reset
signal dispositions/mask, and a slave-open action that establishes the controlling
TTY. No helper executable or process-global cwd mutation. Other cwd/PATH cases
retain std's pre-exec path; Linux remains unchanged. Opaque actions/attributes are
RAII-owned. An own process enum retains direct PID exit state so repeated checks
cannot reap twice or terminate a recycled group after exit.

Full focused unit/lint and explicit uncached25-workspace closure pass. Eleven
Rust tests, ten native groups and244 Vitest cases pass. Actual control check now
opens /dev/tty as well as testing isatty; another real check covers child PATH,
alternate cwd and environment/exit9. Finalizer evidence again terminates/reaps32
owned live sleep processes. Fresh direct/packed artifact checks retain the
single-addon/zero-runtime-groups/import-audit constraints and exercise128 sessions
and4,096 buffers per worker. Own archives/extractions are removed after checks.

Selected128 further retained-session sample: mean creation1.99ms versus1.25ms
reference (improved, but creation gate still fails); complete interaction30.89ms
versus35.27ms. RSS49.71→57.95MB versus60.16→65.45MB. These are macOS workload
measurements, not peak/stability/general performance acceptance. Direct spawn is
not a complete cross-platform optimization. Evidence out/rust-terminal-pilot-spawn-*.

### Named terminal runtime delivery (2026-09-21 UTC)

Additive terminal-pilot-rust/commands currently exposes the named runtime and
SESSION_ENV_VAR, with own Rust Names admission, pending reservations, auto names,
retained exited lookup, conditional forgetting/replacement, ambiguity/available
diagnostics and shutdown guards. Node retains launch/creation/close promises and
session handles. No official SDK runtime delegation. Public error names work
with original Toolcraft isUserError detection; runtime interfaces are checked in
both TypeScript directions. Commands/CLI still need their own implementation.

Portable Names absence reds and missing module red precede implementation. A
retained-byte shutdown red (376 versus56 empty bytes) leads to releasing registry
capacity after successful shutdown. Thirteen Rust tests, eleven native groups,
238 applicable SDK cases plus twelve own Vitest cases pass (250 total Vitest).
Six runtime cases cover concurrent reservation, failed spawn release, completed
history/name replacement, pending creation shutdown/new admission, shutdown retry,
original naming/env/error/retention comparison, invalid pre-effect admission and
launch retry. An invalid fixture reused IDs based on active array length; its
monotonic ID counter corrects the test fixture, with no product change for that
failure. A real native group controls a named own PTY and retains exited snapshots.
Focused lint/fmt/clippy and explicit uncached25-workspace closure pass.

Fresh direct/packed16MiB workers each complete65 named real sessions, retain64
exited snapshots, close all tracked state, launch again and reuse s1. Prior4,096
buffer workers/import AST audit and single-addon/zero npm runtime groups pass.
Own packaged archive/extraction is removed after checks. Evidence
out/rust-terminal-pilot-names-*; endpoint memory is not leak/peak acceptance.
Latest session/exit-tail/spawn commits are delivered to main; original pin fix
release35550571891 is still running. No verified publication/full goal completion.
Conservative active segment01:24:12–01:50:55 UTC is recorded (1,603s); the earlier
checkpoint gap and unrecorded01:20–01:24 minutes are excluded. Full24-hour actual
effort remains unfulfilled. Work continues after this boundary.

### Terminal automation commands, 2026-09-21 02:11 UTC

The additive `terminal-pilot-rust/commands` subpath now provides all13 automation
command descriptors. Rust owns declarations, closed schemas, cached validation,
effect planning and typed result policies; Node executes terminal effects and
ECMAScript regular expressions. The manually generated declaration seed is a
development reference, with no original SDK/Toolcraft production imports. Own
`toolcraft-schema-rust` is a Rust path dependency and an npm development reference.

Portable command tests were red before implementation.15 Rust cases,14 native
groups and263 Vitest cases pass (251 applicable original SDK cases plus12 own).
The native comparisons include exact equality of all26 MCP wire definitions,
all13 automation commands on own real PTYs, getter rejection without evaluating
the getter or resolving a session, and impossible PID output code-32603. Original
16-command inventory, screenshot and installation tests are excluded honestly.
Bidirectional compile contracts now cover every13 individual automation command,
plus the public runtime and Toolcraft base group. A synchronous original handler
required the declaration's `TResult | Promise<TResult>` union; no-return command
results are `undefined`, and the command key schema accepts strings before runtime
validation. Full16-command group inference compatibility remains unfinished.

Focused maintained unit/lint and explicit uncached109-workspace build closure
pass. Fresh direct/packed16MiB workers each run32 real command-controlled PTYs,
retain32 snapshots and close all runtime state. AST auditing covers8 packaged
JavaScript/declaration files; one addon and zero npm runtime/peer/optional
dependency groups pass. Endpoint memory is observational: the parent loads the
TypeScript auditor, so worker RSS includes its process and is not isolated memory
acceptance. Artifacts are purged after checks. Evidence out/rust-terminal-pilot-
commands-*.

Session creation performance, screenshot/installer/CLI, pilot MCP, cross-platform
artifacts, Python and full agent closure remain unfinished. SDK-pin release
35550571891 has build/audit/Bash success but unit is still running; no publication
is verified. Additional conservative active segment01:50:55–02:07:03 UTC (968s)
is recorded. Work resumes02:08:44 UTC after the checkpoint gap;24-hour actual
effort and overall goal remain unfinished.

### Standalone terminal pilot MCP, 2026-09-21 02:23 UTC

`terminal-pilot-mcp-rust` adds the independent application server, original public
`createTerminalPilotMCPGroup()`/`main()`, a suffixed executable and explicit server
factory. One napi-rs addon embeds own terminal and stdio bindings; a development
AST preparation step copies own host adapters/declarations and rewrites relative
imports. No original SDK, Toolcraft or external implementation package is imported
at runtime. The command declaration set supplies13 primary/13 legacy aliases;
Rust compiles and validates wire output schemas and converts exitCode to exit_code.
Node handles streams, SDK transport effects and runtime cleanup. Rust shutdown
admission is permanent, while cleanup failure allows a retry.

Missing-package and portable-policy tests were red before implementation. Further
tests reproduced calls after failed shutdown and null runtime throws; permanent
admission and numeric error normalization fix these. Original SDK tests also
validated the required SDK connect adapter and key error message. The latter has
its own portable red and atomic terminal-pilot-rust fix f55df669e, pushed to main.
Input validation belongs to the Rust command layer, avoiding a second transport
schema validator's different diagnostics; this does not disable command validation.

3 Rust cases,8 native/server groups and all9 actual original SDK/CLI cases pass.
The original architecture-specific runMCP/mock tests are not counted. Exact26-tool
metadata equality, real PTY calls through both aliases, wire result casing,
invalid-key pre-effect admission, impossible PID output, retryable cleanup,
official SDK schema validation and CLI JSON-RPC-only stdout are verified. The
actual CLI EOF case closes a live sleep process and verifies ESRCH after natural
server exit. Original CLI symlink/memfs tests pass; help screenshot is inspected.
Bidirectional original public factory/main and CLI declaration contracts pass,
without production SDK type imports. Lint/fmt/clippy and maintained explicit
uncached110-workspace/29-build closure pass. npm ci dry-run passes. Lock changes
add only this workspace and link; unrelated npm normalization is excluded.

Fresh direct/packed16MiB workers each create16 independent servers, run48 real
PTY sessions through mixed aliases, retain48 history snapshots and16 closed
server objects, and confirm calls after shutdown are rejected. All16 packaged
JavaScript/declaration files pass AST import auditing; one addon and zero npm
runtime/peer/optional groups pass. Endpoint heap is~8.8/~8.7MB; process RSS includes
the parent TypeScript auditor and retained native tool declarations, so this is
not peak/leak acceptance. Closed servers retain tool metadata while referenced.
Archive/extraction are purged after checks. Evidence out/rust-terminal-pilot-mcp-*.

General terminal/agent performance, remaining provider/runtime/design/schema/task
packages, complete poe-agent, Python and cross-platform artifacts remain open.
Release35550571891 has all completed gates successful but unit is still running;
publication is not verified. Overall goal/24-hour actual effort remain unfinished.
Active work resumes02:08:44 UTC after the checkpoint gap and continues.

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

### ACP client rewrite, 2026-09-21 02:58 UTC

The additive private `@poe-code/poe-acp-client-rust` now exposes the complete original
public client, transport, JSON-RPC, update, stream-helper and report API. Rust owns
ACP dialect validation, request correlation, UTF-16 framing, lifecycle/capability
admission, terminal identities, prompt queue admission, tool aggregation, legacy
mapping, usage/error/report policy and redaction. Node supplies streams, process,
promises/callbacks, dates, filesystem and crypto effects. One napi-rs addon embeds
own std/path-only cores, with no original runtime imports or npm runtime/peer/
optional dependency groups. Declaration generation is a manual development-only
reference step; shipped declarations import only local files and Node types.

Portable and original-reference tests were red before the corresponding modules.
15 portable Rust cases,6 native groups and all172 original ACP cases pass. The
reference route now redirects the entire unified suite, transport suite and plan
replay suite without removing describes. Bidirectional public method and function
contracts pass. Original tests cover real subprocess lifecycle, memfs report
persistence, fs/terminal/permission callbacks, sessions, prompt multiplexing,
extensions, cleanup/retry, schemas and malformed numeric payloads.

Additional reproduced defects include retained replaced callbacks, completed
512KiB framing allocation, notification-to-next-frame handler ordering, invented
signal after rejected TERM, cyclic opaque notification payload rejection and
notification identity loss. The fixes release replaced callback identities and
large completed framing buffers, dispatch frames sequentially, distinguish failed
signal delivery, project protocol fields through data descriptors without calling
accessors/hooks and queue host identities via Rust-admitted tokens. Closed queues
refuse tokens, preventing early-return notifications from accumulating host refs.
State getters now read the native scalar directly:100 reads with512KiB negotiated
metadata improved from16.41ms to0.042ms in the observed microbenchmark.

Focused lint/fmt/clippy, type contracts, npm ci dry-run and the maintained explicit
uncached111-workspace/5-build/330-edge closure pass. Direct and packed16MiB workers
each run32 injected clients,8 real subprocesses and544 prompt turns while retaining
544 notification objects and40 closed clients. All18 packaged JavaScript/type
files pass AST import auditing; one addon and zero dependency groups pass. Endpoint
heap is~8.3MB. Worker RSS includes the parent TypeScript auditor and is not isolated
leak acceptance. Evidence out/rust-acp-*.

Separate fresh-process packet benchmarks retain128 outputs and compare identical
checksums. For8192 small mixed packets, TypeScript samples are4.12–6.04ms and Rust
bindings30.11–36.49ms. Post-GC heap is~4.84/~4.82MB and RSS~57.3/~58.1MB. This is
explicitly a failing performance advantage gate; there is no Rust speed or memory
advantage claim. Conversion overhead needs further profiling. Native scalar state
reads also remain slower than the original JS getter despite avoiding metadata
copies. Prompt queues retain unread values and are not bounded by a configured
limit. Aggregate/getter acceptance beyond notifications, platform artifacts,
Python bindings and broad agent performance remain incomplete.

Release35550571891 finished all gates successfully, but its release job explicitly
skipped publication because its main checkout was stale. Release35554043660 failed
its root workspace dependency test for missing safe-bash-mcp; that failure is
reproduced locally and will receive a separate focused fix. No published release
is verified. Remaining agent-spawn/poe-agent, provider/config/task/runtime/design
closure and overall goal are unfinished. The inherited active02:08:44–02:41:05 UTC
segment (1,941s) is now recorded; work resumed02:43:12 UTC after the checkpoint gap.
The24-hour minimum actual effort remains unfulfilled.

### Declarative spawn metadata, 2026-09-21 03:03 UTC

Own agent-defs-rust provider files now optionally declare CLI/ACP spawn descriptors.
The Rust registry validates these as objects and keeps them separate from public
agent metadata. A custom-provider test was red before implementation and verifies
one-file registration and malformed-descriptor rejection. Seven existing provider
files contain launch/mode/stdin/resume/model/MCP declarations; callable original
functions were translated to declarative templates/recipes, not copied as runtime
code. CLI ordering is explicit business metadata, while agent ids/export names are
derived from the existing provider file. There are no provider-id switches in the
runtime. This is the input foundation for agent-spawn-rust, not a completed spawn
engine. Focused maintained catalog tests, lint and uncached build pass.

ACP feat184aed2fe and workspace-registration fix90fd872e2 are verified ancestors
of remote main after rebasing on the concurrent documentation commit. The latter
fix adds safe-bash-mcp to root development dependencies and lock metadata; both
existing workspace-completeness cases now pass, JSON formatting and npm ci dry-run
pass. Release35555963233 is pending. No publication is verified. An experimental
ACP conversion through host JSON.parse did not improve the measured throughput
and was discarded; the failing packet performance advantage gate remains open.

### Spawn planning baseline, 2026-09-21 03:15 UTC

The additive private agent-spawn-rust package implements CLI launch planning, the
immutable CLI/ACP registry, permission-mode admission, model transformations,
resume templates, UTF-8/NUL stdin fallback, prompt redaction, MCP serializers and
environment merge/deletion. Own Rust provider files are the single declarative
input: ids/export names derive from agent metadata, callbacks materialize generic
Rust recipes and no runtime provider-id branches are present. An independent
custom-provider portable test builds a new launch by supplying one definition.
Original production consumers and implementation packages remain unchanged.

This is explicitly a planning baseline, not the completed agent-spawn rewrite:
process execution, retries/parallel runs, adapters/streaming, telemetry,
resources/runtime/workspace bridges, logs and remaining exports are unfinished.
Shipped declarations advertise only the implemented baseline. Node still handles
registry object materialization and host identity restoration; core admission,
models, templates, argument ordering, serializers and environment policy are Rust.
Manual development-only contract generation imports original declarations only.

3 portable Rust cases,4 native groups and97 applicable original tests pass. The
native checks compare1440 full launch permutations and300 ACP recipe combinations,
preserve lone surrogates in models/MCP arguments and exercise prototype-named
servers/env keys and environment deletion. All buildSpawnArgs/configs/mode cases
run against own modules; actual spawn/API inventory describes are not counted.
Original tests reproduced the wrong MCP/mode validation order. Further native reds
reproduced Goose surrogate loss and Gemini null-server flags; UTF-16 concatenation
and declarative recipe truthiness fix these. The latter is separate catalog
commit f59e60d95, verified on remote main. Public planning APIs have bidirectional
TypeScript contracts. Display argument construction avoids cloning prompt payloads
before redaction.

Focused lint/fmt/clippy, unit/types, npm ci dry-run and maintained explicit uncached
112-workspace/21-build/333-edge closure pass. Direct/packed16MiB workers each run
8192 plans,8192 MCP serializers and8192 environment merges while retaining256 plans.
All22 packaged JS/declaration files, including generated provider submodules, pass
recursive AST import auditing. One addon and zero npm runtime/peer/optional
contexts pass. Endpoint heap~7.7/~8.1MB; RSS includes parent TypeScript tooling and
is not isolated leak/peak acceptance. Fresh-process planning performance evidence
is out/rust-agent-spawn-benchmark.json; no broad speed/memory advantage is claimed.
Evidence out/rust-agent-spawn-*; remaining aggregate/getter/platform/Python and
full agent acceptance remain open. Latest release35556765333 is pending; no
publication is verified. The24-hour minimum effort and overall goal remain open.

### Spawn retry implementation, 2026-09-21

The agent-spawn-rust retry API now owns validation, attempt transitions, stop/check/
wait decisions, capped exponential backoff and event prefix selection in Rust.
Node supplies promises, callbacks, timers and AbortSignal effects. The event queue
reuses own ACP Rust token admission and keeps arbitrary/cyclic values in their
originating isolate. Custom retry callbacks are captured once at invocation;
mutation during an asynchronous attempt was reproduced with a red native case.
Rust transitions reject reentry/out-of-order calls, covered by a red portable case
before implementation. Zero-base exponent overflow preserves JavaScript NaN.

Event declarations use original structural declaration contracts only, with the
ACP Plan import rewritten through the TypeScript AST to own local protocol types.
No original runtime implementation is copied or imported. Bidirectional supported
public API types, 6 portable Rust cases, 5 native groups and all 110 applicable
original cases pass. Maintained focused lint/fmt/clippy, unit/types, npm ci dry-run
and explicit uncached build closure (112 workspaces/22 builds/335 edges) pass.
Direct and packed 16MiB workers each complete 8192 launch plans/serializations/env
merges and 512 retry attempts/1280 events, retaining 256 plans and 32 closed handles.
Cyclic tool payload identity and arbitrary falsy failures survive. Recursive AST
import audit covers 27 shipped JS/declaration files, one addon and zero npm
runtime/peer/optional groups. Worker heap endpoints ~9.2MB; process RSS includes
the auditor parent. This is bounded stability evidence, not leak/peak acceptance.
Unread event queues remain unbounded like the original. Evidence out/rust-agent-
spawn-retry-*; parallel/execution/adapters/full agent closure remain unfinished.

The conservative inherited active segment 02:43:12–03:14:16 UTC (1864s) is now
recorded, excluding the checkpoint gap. Work resumed 03:21:02 UTC. The frozen goal
counter plus previously recorded segments and this inherited segment total 78908s
(21.92h); the minimum 24-hour effort and overall rewrite remain unfinished.
Release 35556922386 for planning commit 753e96c6d remains pending; no publication
is verified. This retry change is locally verified; delivery is recorded separately.

### Spawn parallel scheduling, 2026-09-21 03:27 UTC

The independent parallel combinator uses Rust to validate concurrency/check policy,
admit bounded work, record completion/rejection, choose the primary failure and
select the first failed result in input order. Node effects invoke tuples/thunks,
drain streams, await results and link AbortSignals, preserving opaque result and
failure identity. Native status holds no host payloads. Portable red tests precede
implementation and cover admission limits, duplicate completion, collection and
peer cleanup after stopping. All 78 original parallel cases run through own
combinator, using an explicit thunk-only fixture for the original spawn.parallel
calls. This verifies the combinator, not the unfinished production spawn assembly.
An additional native identity/listener case verifies both parent and tuple abort
listeners are removed after success. All 8 portable cases, 6 native groups and
188 applicable reference tests, bidirectional declarations, maintained lint and
explicit uncached focused build closure pass. Packed/direct 16MiB workers each
add 2048 ordered parallel calls to existing planning/retry evidence. Recursive
import audit covers 29 files, one addon and zero runtime dependency groups. Heap
endpoints ~12.1MB and parent-inclusive RSS are bounded workload evidence only.
Evidence out/rust-agent-spawn-parallel-*. Actual command/stream execution and the
larger closure remain unfinished. Retry commit ab1aa9f03 is verified on remote
main; its release 35557365606 is queued. Earlier planning release was cancelled.
No successful publication or overall/minimum-effort completion is claimed.

### Independent command execution, 2026-09-21 03:29 UTC

The additive runCommand API uses Rust for output ownership, managed-group policy,
first termination admission, error/signal/timeout/abort result selection, messages,
timing policy and single completion. Result extraction moves output buffers out
of native state; completed commands reject additional buffer retention. Node
supplies subprocess/stdin/UTF-8 decoding/signals/timers and group-exit probes.
Portable tests were red before implementation. A real-subprocess native red
reproduced an own duplicate getter read; normalized own options now read once.
Inherited options/numeric error codes are ignored, matching original contracts.

All 10 portable Rust cases, 7 native groups and 196 applicable original cases
pass. The eight newly redirected command cases include the actual Unix shell-
descendant cleanup integration test; nothing is filtered from these suites.
Bidirectional runCommand types, maintained lint/fmt/clippy, package unit checks,
formatting and explicit uncached focused build closure pass. Packed/direct16MiB
workers each add16 real subprocess calls, retain8 output results, and validate
pre-start cancellation alongside existing planning/retry/parallel workload.
Recursive AST audit covers31 files, one addon, no npm runtime/peer/optional groups.
Heap endpoints~9.1/~9.4MB; RSS still includes auditor parent. There is no isolated
leak/peak or throughput advantage claim. Output has no size cap, matching original.
Evidence out/rust-agent-spawn-command-*. Full agent spawn, adapters/rendering,
resources/runtime/telemetry and larger closure remain unfinished. Parallel commit
0e0762140 is verified on remote main. Release35557562373 is pending; retry release
35557365606 is in progress. No successful publication is verified.

### Six independent stream adapters, 2026-09-21 03:36 UTC

Rust independently parses and normalizes Claude, Codex, Cursor, native, OpenCode
and Pi JSONL streams, with per-invocation tool/session/usage/error state. Native
bindings restore explicitly undefined properties through output descriptors;
Node supplies asynchronous iteration and SyntaxError stack effects. Metadata,
checklists, permission denials, completed-only tool lifecycles, usage/cost fields,
Pi results, Cursor arguments and Codex sandbox diagnostics match the supported
original behavior. Portable adapter tests were red before implementation. A
native red reproduced eager unrelated thread getter evaluation; host property
effects now short-circuit. Native checks also preserve lone UTF-16 surrogates,
JSON-stringified tool results and nested undefined command input properties.

All12 portable Rust cases,8 native groups and282 applicable original cases pass.
Both whole original adapter/action suites are redirected without filtered tests;
original tool-summary rendering remains a development reference in action cases.
Bidirectional adapter public contracts, maintained focused unit/types/lint/
fmt/clippy/formatting and explicit uncached build closure pass. Direct/packed16MiB
workers each normalize1536 adapter lines into1920 events in addition to existing
planning/retry/parallel/real-command workload. Recursive AST import audit covers34
files, one addon and zero npm runtime/peer/optional groups. Heap endpoints~9.3MB;
parent-inclusive RSS is not isolated acceptance.

Isolated adapter-module benchmark out/rust-agent-spawn-adapters-benchmark.json:
6145 mixed small events per round take original4.09–5.93ms versus native14.10–
16.59ms. Post-GC JS heaps original~3.94MB/native~3.75MB; final RSS original~59.3MB/
native~54.1MB over six rounds. This does not establish a full-library advantage
or long-term leak acceptance. Throughput advantage gate fails. Parser limits
16MiB/depth128/262144 values differ from unrestricted JSON.parse and are disclosed
in package README; limit interoperability remains unfinished. Evidence out/rust-
agent-spawn-adapters-*. Command commit98234a0cd is verified on remote main. Its
release35557730932 is pending; older parallel release was cancelled and retry
release35557365606 remains in progress. No publication verified. Full spawn,
rendering/resources/runtime/telemetry, poe-agent closure and minimum effort remain
unfinished; production imports remain unchanged.

### Native line framing and middleware, 2026-09-21 03:41 UTC

Rust now owns incremental UTF-16 line framing/EOF and middleware repeated-next
admission/invalid-entry validation. Node supplies StringDecoder, asynchronous
Readable effects, callback property access and shared context identity. Scanning
starts at the new chunk boundary to avoid rescanning incomplete lines. EOF clears
native buffers; post-EOF writes retain nothing. A portable red reproduced large
completed-line capacity retained behind a tiny partial tail; disproportionate
capacity is now discarded. A native red reproduced callback-getter evaluation
before a repeated-next rejection; guard ordering now precedes callback access.

All15 portable Rust cases,10 native groups and294 applicable original cases pass.
The whole original readLines/applyMiddlewares describes (12 cases) run through own
modules. Remaining ACP rendering/spawn describes are explicitly excluded and not
counted. Native checks cover every UTF-8 split of a multi-line sample, CR/empty
lines, lone surrogates and arbitrary falsy middleware failure reasons. Supported
public types are bidirectional. Maintained unit/types/lint/fmt/clippy/formatting
and explicit uncached focused build closure pass. Packed/direct16MiB workers add
384 framed lines and512 middleware invocations; recursive import audit covers36
files, one addon and zero runtime dependency groups. Heap endpoints~8.9MB and
parent-inclusive RSS are bounded checks only. Incomplete lines have no size cap.
Evidence out/rust-agent-spawn-stream-*. Full agent/runtime closure remains open.

Adapter commit6b561be65 is verified on remote main. Its release35558160806 is
pending. Retry release35557365606 has successful build/audit/checks/cached-unit
jobs but a failed fresh-unit job, now being investigated while bash jobs run.
No successful publication is verified. Active03:21:02–03:41:16 UTC (1214s) is now
recorded, excluding the inherited checkpoint gap. Conservative total80122s
(22.26h), minimum remaining6278s (1h44m38s). Work continues beyond this boundary;
minimum24-hour actual effort and the full goal remain unfinished.

### Root private-workspace metadata reconciliation, 2026-09-21 03:43 UTC

The failed fresh-unit job106205397911 from retry release35557365606 reproduces
locally: standalone-package-metadata forbids the safe-bash-mcp root development
dependency required by workspace-deps for test/build membership. The existing
publication assertion now verifies no runtime dependency/export/bin/files entry,
explicit private workspace status, and development-only registration. Production
metadata/implementation/release wiring is untouched by this test correction.
Both whole focused suites pass21 cases after the red reproduction; focused ESLint
and diff whitespace checks pass. Evidence out/rust-root-private-workspace-* and
out/rust-release-35557365606-unit.log. Stream-framing commit7efd29145 was pushed;
remote ancestry/release verification will continue separately. Goal and minimum
24-hour effort remain unfinished; no publication is verified.

### ACP session-update conversion, 2026-09-21 03:48 UTC

The independent converter uses Rust for render-kind/title/tool-start/completion
admission and usage/cache/reported-cost policy. Public mutable sets/maps supply
per-tool facts to Rust; original state identity and caller mutations are preserved.
Opaque raw inputs and plan entries stay in the originating isolate. Node supplies
JSON/string effects for opaque output only after Rust emits a completion; Rust
selects text-content fallback. Portable red tests precede implementation. Native
reds reproduce eager pending-output/deduplicated-input effects and unnecessary
cost/unused-title getter evaluation. Effects are now deferred to emitted events,
USD costs are captured once and unused update titles are not read.

All17 portable Rust cases,13 native groups and310 applicable original cases pass.
The complete original converter suite (16 cases) is redirected without filters.
Native checks preserve cyclic input/plan-entry identity, cyclic-output fallback,
external state clearing/changes, surrogate ids/titles, NaN/Infinity usage and cost
reporting. Bidirectional public declarations, focused unit/types/lint/fmt/clippy/
formatting and explicit uncached build closure pass. Direct/packed16MiB workers
each convert2048 updates into2048 render events, retain4 public render states and
complete the existing planning/retry/parallel/command/adapter/framing/middleware
workload. Recursive AST import audit covers38 files, one addon and no npm runtime
/peer/optional groups. Heap endpoints~9.1/~12.8MB are bounded workload evidence;
RSS includes auditor parent. Caller-owned render maps retain tool history until
cleared/discarded. Structured conversion fields use the disclosed bounded parser;
unrestricted host-value interoperability and aggregate/getter/performance
acceptance remain unfinished. Evidence out/rust-agent-spawn-render-*. This is
locally verified; delivery is recorded separately. Root metadata correction
45c7cf2e5 and stream commit7efd29145 are verified ancestors of remote main.
Release35558479691 is in progress; no successful publication is verified. Full
spawn/runtime/telemetry/resource/design and poe-agent closure remain unfinished,
as does the minimum24-hour actual effort. Work continues beyond03:41:16 boundary.

### Poe Agent Rust provider foundation, 2026-09-21 03:57 UTC

New additive private poe-agent-rust exposes independent collectProviders,
resolveProvider and the provider/name error classes. Rust owns ordered registration,
collision data, resolution check transitions, UTF-16 diagnostics, ASCII tool-name
admission and reusable session-id admission. Node keeps providers/callbacks/options
in the originating isolate, handles support checks and error causes, and preserves
private metadata and provider identity. There are no provider-name switches.
Callback selection is generic. One plugin/provider registration supplies its own
support/createModel behavior. A portable red precedes implementation. Native red
reproduces callbacks extending the provider list during resolution; dynamic list
length now supplies each Rust admission check, preserving original iterator behavior.

All3 portable cases,2 native groups and21 complete original provider/name cases
pass. Native tests preserve method receivers, cyclic opaque options, surrogate
names/messages, falsy thrown causes and deferred model creation. Supported root
public APIs have bidirectional TypeScript contracts. Manual development-only
structural declaration seeding imports no original runtime and shipped types have
local dependencies only. Maintained unit/types/lint/fmt/clippy/formatting, npm ci
dry-run and explicit uncached selected113-workspace/28-build/338-edge closure pass.
Direct/packed16MiB workers each perform8192 collections/resolutions and24576 support
checks, retain128 provider collections, and validate collisions/falsy causes.
Recursive artifact import audit covers15 JS/declaration files, one addon and zero
npm runtime/peer/optional groups. Heap endpoints/parent-inclusive RSS remain bounded
workload evidence only. Evidence out/rust-poe-agent-providers-*.

This is a provider foundation, not the completed agent rewrite. Agent builders,
sessions, model/tool iteration, built-in plugins and transcript persistence are
unfinished and not advertised as implemented. Original production imports and
release wiring remain unchanged. Converter commit eba871f8e is verified on remote
main. Publication and overall/minimum-effort completion remain unverified/open.
Work continues beyond the recorded03:41:16 effort boundary.

### Poe Agent Rust session storage, 2026-09-21 04:07 UTC

Independent createAgentSessionStore now uses Rust for version1/metadata/message
and structured text/image/error-part validation. Node supplies injectable/default
filesystem access, home/path effects and standard save serialization. Portable
and native reds precede implementation. All4 Rust cases,5 native groups and40
complete original cases pass, including all19 original session-store cases.
Native checks preserve extension fields, own __proto__ properties, lone
surrogates, mkdir-before-stringify order and arbitrary falsy failure reasons.
Malformed JSON uses host parsing only after Rust syntax rejection to reproduce
engine diagnostics; bounds rejections never retry unrestricted host parsing.
The disclosed16MiB/depth128/value262144 parser limits remain interoperability
limitations. Supported root types, focused unit/lint/fmt/clippy/formatting and
explicit uncached113-workspace/28-build/338-edge closure pass. Direct/packed
16MiB workers each complete1024 saves/loads with16 in-memory records and32
retained sessions alongside8192 provider collections/resolutions and24576
support checks. Recursive artifact audit covers17 JS/declaration files, one
addon and zero npm runtime groups. Heap endpoints~7.7/~7.6MB and parent-inclusive
RSS are bounded workload evidence only. Evidence out/rust-poe-agent-session-*.

Provider commit72325c31e is verified on remote main. Release35558479691 and
provider release35559290196 remain under monitoring; publication is unverified.
This storage increment is locally verified; delivery is recorded separately.
The full agent/runtime/closure rewrite and minimum24-hour effort remain open.
Conservative active03:41:16–04:01:41 UTC adds1225s; total81347s (22.60h),
minimum remaining5053s (1h24m13s). The checkpoint gap04:01:41–04:03:46 is
excluded. Work resumed04:03:46 UTC and continues beyond this boundary.

### Poe Agent Rust history stores, 2026-09-21 04:09 UTC

Independent Rust MemoryStore owns parsed transcript values and clones them into
Node on listing; clearing drops retained capacity. JSONL replay validates all
seven entry kinds, follows original metadata/array admission, trims ECMAScript
whitespace and preserves source line numbers. It tolerates only a final syntax
failure without a terminating newline; valid-but-invalid final entries reject.
Bounds violations always reject, including final records. Node supplies ordered
filesystem promises, serialization effects and missing-file handling. Failed
write queues preserve arbitrary causes and suppress subsequent filesystem effects.
Memory stores retain original re-use-after-disposal behavior.

Portable red precedes implementation. All5 Rust cases,10 native groups and59
complete original cases pass, including all19 original history-store cases.
Differential entry-kind/metadata mutation coverage and native serialized-write,
failed-queue, hook, Unicode, __proto__, deep-isolation/disposal and parser-bound
checks pass. Bidirectional internal-store contracts and supported root contracts,
focused unit/lint/fmt/clippy/formatting and uncached113-workspace/28-build/338-edge
closure pass. Direct/packed16MiB workers each add2048 memory appends,96 memory
listings,512 JSONL appends and8 replays alongside the provider/session workload.
Recursive artifact audit covers20 JS/declaration files, one addon and zero npm
runtime groups. Heap endpoints~8.9MB and parent-inclusive RSS are bounded checks,
not isolated peak/leak acceptance. The parser limits remain disclosed. Evidence
out/rust-poe-agent-log-*. Session commitff44b885c is verified on remote main.
Release35558479691 still runs fresh unit after other validation jobs passed;
no successful publication is verified. Full rewrite and minimum effort remain
open. Work continues beyond the04:03:46 active-segment boundary.

### Poe Agent Rust tool registry, 2026-09-21 04:16 UTC

Independent Rust tool catalog owns ordered name indices, lookup trimming,
selector normalization/deduplication and exact/dot/underscore namespace
visibility. Node owns frozen normalized snapshots, callbacks, opaque schemas/
policy, generator method admission and promise/generator effects. Copies preserve
shared snapshots and replacement order. Selector getter effects run before native
catalog admission to permit registration reentry without borrowed-state failure.
Rust also owns runtime-error diagnostics; Node error classes preserve stack/cause.

Portable red precedes implementation. All7 Rust cases,13 native groups and77
applicable original cases pass. The complete runtime-errors/normalizeTool/
ToolRegistry describes (18 cases) are extracted with the TypeScript AST; all other
runtime describes remain explicitly excluded and uncounted. Native checks preserve
cyclic schema identity, receivers, bound call snapshots, arbitrary sync/async
failure reasons, streamed generator identity, registry-copy replacement order,
selector callback mutation and Unicode namespace boundaries. Bidirectional tool
normalization/errors and public registry methods pass; nominal private copyFrom
accepts only same-implementation registries, as disclosed. Focused unit/lint/fmt/
clippy/formatting and uncached113-workspace/28-build/338-edge closure pass.
Direct/packed16MiB workers each add2048 tool registrations,1024 lookups,512
visibility selections and512 actual invocations to provider/storage/history work.
Recursive artifact audit covers24 files, one addon and zero npm runtime groups.
Heap endpoints~10MB and parent-inclusive RSS are bounded evidence only. The tool
benchmark gate fails:4096 lookups/64-tool visibility selections per round take
original~8–10ms versus Rust~28–30ms after warmup. No performance/memory advantage
is claimed. Evidence out/rust-poe-agent-tools-*.

History commit152ca653e is verified on remote main. Release35558479691 failed
fresh unit in mcp-oauth-rust: callback denial body, authorizeRequest returned token
snapshots and concurrent session store effects differ from the evolving original.
Current local red also reveals new client/scope/session hardening and profile
persistence contracts; production concurrent edits are preserved. These remain
required follow-up work, not waived failures. This tool increment is focused-check
verified; remote delivery is recorded separately. Overall rewrite, release and
minimum24-hour effort remain open. Work continues from04:03:46 UTC boundary.

### OAuth Rust callback lifecycle reconciliation, 2026-09-21 04:19 UTC

CI denial-body failure reproduces locally against the current original. Rust now
uses the same complete OAuth authorization diagnostic for rejection and HTTP body.
Rust owns single-use/idempotent lifecycle admission, supported timer admission and
loopback target policy. Node supplies standard URL/HTTP/timer/signal/callback effects.
Exact fixed redirects preserve registered ports, query and paths; only original
loopback host allowlist/HTTP/no-credentials/no-fragment/no-spoofed-parameter rules
admit listeners. Caller abort and default/configured deadlines tear down owned
listeners; settlement removes request handlers immediately. Browser/manual hooks
run asynchronously and preserve arbitrary rejection causes.

Portable/native reds precede changes. All31 portable Rust cases,6 complete native
loopback groups and20 complete original loopback/lifecycle cases pass. Focused
lint/fmt/clippy/formatting and uncached113-workspace/8-build/338-edge closure
pass. The broad TypeScript fixture fails on the newer provider returned-token
contract and remains required follow-up; loopback options are declared locally. Direct/packed16MiB workers each run512 listener cycles (384 successful,
128 arbitrary-cause cancellations), verify single-use waits and all listener
cleanup, and reject unsafe redirects before listener allocation. Artifact audit
covers14 JS/declaration files, one addon and zero runtime groups. Heap endpoints
~9.2MB and parent-inclusive RSS are bounded evidence only. Evidence
out/rust-oauth-loopback-*. The complete maintained OAuth unit route was also run:
46/56 native groups pass;10 failures remain in evolving provider/storage/token
contracts and are not waived. Original source now adds stricter scope syntax,
client binding, pending refresh outcomes, token snapshots, transactions and
profile persistence. These are required follow-up work, preserved concurrent
production edits remain untouched, and README now states incomplete provider
conformance. Tool registry commit4d3f64f9f is verified on remote main. Release
publication, overall rewrite and minimum24-hour effort remain unfinished.
Active04:03:46–04:18:55 UTC adds909s; total82256s (22.85h), minimum remaining
4144s (1h09m04s). Work continues beyond this recorded boundary.

### OAuth Rust authorized-token snapshots, 2026-09-21 04:20 UTC

A valid-current-client native red reproduces authorizeRequest returning undefined
instead of the normalized grant. Success now returns a fresh snapshot after
attaching the header; mutation cannot alter persisted/native-normalized tokens.
The provider return declaration now admits the original token-or-void contract.
The complete focused native snapshot case and broad TypeScript fixture pass after
red reproduction; maintained uncached build closure, package build, prior unchanged
Rust lint and whitespace checks pass. Evidence out/rust-oauth-snapshot-*.

The prior loopback delivery entry incorrectly included broad type-check success:
the actual fixture failed at the supplied-provider assignment because its
returned-token contract was outdated. That entry is corrected above; the fixture
now passes with this increment. Callback commitb89dafb9b was pushed; remote
verification continues separately. Provider/client/scope/storage conformance
failures still require follow-up. No release or overall/minimum-effort completion
is claimed. Work continues beyond04:18:55 effort boundary.

### OAuth Rust scope reconciliation, 2026-09-21 04:25 UTC

Current token-scope reds reproduce stricter original grammar. The reusable Rust
scope core rejects nonstrings, controls, non-ASCII, quotes and backslashes,
canonicalizes printable ASCII token sets in lexical order and preserves case.
Token-response scope validation occurs after expiry completion/clock effects;
supplied empty sets have the original token-response-specific diagnostic.
Provider-loaded token scopes use checked Rust normalization with host Error shape;
invalid clients retain original token-admission short-circuit behavior.

All32 Rust cases and2 focused native scope groups pass, including2048 seeded
ASCII/invalid-value comparisons and expiry/clock failure priority. The old Rust
invalid-optional-scope expectation is updated against reproduced current-source
contract evidence. Full token-native suite now passes5/6 groups; the remaining
form/header failure is the newly added token endpoint auth-method contract and is
required follow-up, not waived. Focused lint/fmt/clippy/formatting/types and explicit
uncached113-workspace/8-build/338-edge closure pass. Direct/packed16MiB workers add
8192 scope canonicalizations to512 callback listener cycles each. Artifact audit
covers15 JS/declaration files, one addon and zero npm runtime groups. Heap endpoints
~9.6MB and parent-inclusive RSS remain bounded evidence only. Evidence
out/rust-oauth-scope-*. Complete provider/storage/auth-method conformance remains
unfinished, alongside the full agent/runtime/closure and minimum24-hour effort.

Snapshot push562172709 was rejected because remote main advanced. Nonoverlapping
remote changes were rebased with automatic preservation/restoration of tracked
uncommitted edits; untracked edits remained present. The rewritten snapshot
commit80a63c201 was pushed and is verified on remote main; the concurrent original
registration commit was preserved without taking ownership. Callbackb89dafb9b is
also verified on remote main. Release35560793819 is pending; no successful
publication is verified. Work continues beyond04:18:55 recorded effort boundary.

### OAuth Rust token endpoint authentication, 2026-09-21 04:28 UTC

The remaining token-native form/header failure reproduces new original defaults
and authentication methods. Independent Rust plans now select public-client,
client_secret_post or client_secret_basic authentication, reject unsupported
methods/missing secrets, form-encode credentials before standard padded base64
and omit Basic client credentials from the body. Explicit public clients never
send an available secret. Node supplies Headers/fetch and combines caller signals
with the original30-second deadline; pre-aborted reasons retain identity.

The valid native form/header red precedes implementation. All33 Rust cases,
10 complete focused native token/scope/auth groups and28 complete original token/
auth/bounds/lifecycle cases pass.128 seeded Unicode credentials across four
method/default settings compare actual Headers/body/results with the original.
Missing secrets and unsupported methods reject before fetch. Focused lint/fmt/
clippy/formatting/types and uncached113-workspace/8-build/338-edge closure pass.
Direct/packed16MiB workers each add768 real mocked-fetch token exchanges (256
per method) to8192 scope canonicalizations and512 callback listener cycles.
Artifact audit covers15 JS/declaration files, one addon and zero npm runtime
groups. Endpoint heap~14MB includes newly created deadline signals; it is not
isolated peak/leak acceptance or a memory advantage claim. Evidence
out/rust-oauth-token-auth-*. The prior scope increment also passes the complete
original token-endpoint suite16 cases (out/rust-oauth-scope-sdk.log).

Provider-selected auth methods, full registration metadata, refresh outcome/
transaction/client/scope/provenance/profile/initial-grant contracts and complete
aggregate/getter acceptance remain required follow-up. Source adapters still
have bounded parser/value interoperability constraints. The full agent/runtime/
closure, release publication and minimum24-hour effort remain unfinished. Scope
commit4657d5d53 was pushed; remote verification continues separately. Work
continues beyond04:18:55 effort boundary.

### OAuth Rust registration admission, 2026-09-21 04:38 UTC

The portable red test preceded the independent full RFC7591 registration parser.
Rust now validates known nullable metadata, safe nonnegative timestamps, scope
syntax and JSON extensions, with depth64,20,000-value and64KiB serialized UTF8
bounds. The native descriptor reader ignores nonenumerable/symbol metadata,
accepts array subclasses and extra array fields, refuses holes/accessors/nonJSON
values and never invokes serialization hooks. Diagnostics mask ingress exceptions
without quoting credentials; missing client IDs retain their specific error.
Copies retain own __proto__, nulls and lone surrogates without shared ownership.

All34 Rust cases and4 native parser groups pass, with512 generated extension
records and exact boundary comparisons against the original. Focused lint/fmt/
clippy/types and uncached113-workspace/8-build/338-edge closure pass. Direct/packed
16MiB workers each add4096 registration copies to512 callback cycles,8192 scope
normalizations and768 mocked-fetch token exchanges. Artifact audit covers16 JS/
declaration files, one addon and zero npm runtime groups. Endpoint heaps~11MB
and parent-inclusive RSS are bounded workload evidence, not leak/peak or
performance advantage acceptance. Evidence out/rust-oauth-registration-*.

Complete maintained unit rerun now has57/65 native groups passing;8 provider/
session failures remain and must be fixed. It stops before original-suite and
types stages, so no full-unit success is claimed. Parser admission is not yet
wired into provider persistence. Remote c39e11f1a token-auth delivery is verified.
Latest release35561487126 is in progress;35561636130 is pending. No publication or
overall rewrite completion is claimed.

Conservative previously unrecorded active04:18:55–04:31:00 segment adds725s,
bringing recorded actual effort to82,981s (23.05h). The later checkpoint gap is
excluded; this continuation is measured from04:34:58 UTC. Minimum24-hour actual
effort remains unfulfilled.

### OAuth Rust stored-client normalization, 2026-09-21 04:41 UTC

Independent Rust stored-client normalization trims own identity fields, validates
and retains full owned registrations, checks registered client ID/secret equality,
normalizes supported authentication methods and rejects configured/registered
method conflicts. The host evaluates identity before method and registration
getters; registration descriptor admission never calls credential serialization
hooks. Native and portable reds precede implementation. Root types expose the
owned registration/client contracts and compare bidirectionally with originals.

All37 Rust cases and5 focused native registration/client groups pass. Focused
lint/fmt/clippy/types and uncached113-workspace/8-build/338-edge closure pass.
Reference configuration redirects client-registration imports to the own package.
The complete original reference run explicitly fails111/335 cases across15 files,
with224 passing and one unhandled rotating-refresh error: provider transactions,
initial grants, persistence namespace, profiles, scope, registration lifecycle,
cancellation and provenance still require reconciliation. No failures are filtered
or counted as passes. The rebased native route passes63/65 groups, leaving its two
concurrency groups unresolved. Evidence out/rust-oauth-stored-client-* and
out/rust-oauth-registration-rebased-unit.log.

Parser9d433b732 is pushed and verified on remote main. The earlier parser commit
was rebased after preserving concurrent original issuer/expiry work and three
concurrent Rust persistence/binding commits. Both independently added provider
Rust test blocks remain. This follow-up does not yet integrate stored-client
normalization into provider policies. Full goal/minimum effort/release acceptance
remain incomplete; effort continues beyond04:34:58 boundary.

### OAuth Rust transaction ticket core, 2026-09-21 04:45 UTC

Portable/native reds precede a reusable per-resource transaction queue. Rust owns
ordered predecessor tickets, retirement/resource cleanup and schedulable timeout
admission. The Node host owns opaque operation promises, abort listeners, timers
and backend withLock effects. Canceled/timed-out waiters release their own future
without bypassing an unresolved predecessor. Stores are weakly owned; retired
queues remove resource state. Other resources proceed independently, failed
operations permit later operations and arbitrary cancellation causes retain identity.

All39 Rust cases and4 own native transaction groups pass, alongside4 original
oracle groups. Focused lint/fmt/clippy/types and uncached113-workspace/8-build/
338-edge closure pass. The static generic transaction API is bidirectionally
assignable with the original and exposes optional backend locks. Direct/packed
16MiB workers each add3072 serialized operations and8192 ticket admission/retirement
cycles, verifying zero retained resources, to the prior callback/scope/token/
registration/client workloads. Artifact audit covers17 JS/declaration files,
one addon and zero npm runtime groups. Endpoint heaps~13.6MB and parent-inclusive
RSS remain workload observations, not isolated leak/peak or speed acceptance.
Evidence out/rust-oauth-transaction-*. Provider integration into its own Rust
adapter is the next increment; production originals remain preserved.

Stored-client76adb8d82 was pushed within concurrent cb2292867; delivery verification
continues separately. Root release35562026746 is pending. A tiny-http package
release35561781557 succeeded independently, but no current root publication is
claimed. The mistakenly queried archived workflow named Release returned historical
runs; current monitoring uses the branch run list and concrete run IDs. Full
rewrite and minimum24-hour actual effort remain unfinished.

### Rust provider native transaction integration, 2026-09-21 04:48 UTC

The Rust provider now uses the portable ticket queue through the own host adapter
for complete read/redeem/write transactions. All23 complete original transaction,
request-cancellation and uncertain-refresh cases pass with this queue. Concurrent
remote refresh recovery/provenance implementations are retained, including pending
intent before redemption, outcomeKnown classification and signal propagation.
The latest whole native route passes72/74 groups; its two dynamic flows now expose
the concurrently added exact requested-redirect identity contract, requiring the
next reconciliation. No full-unit success is claimed.

The initial rebase encountered a main-reference race while another local process
committed original redirect changes. It was quit without resetting main; its
checkpoint remains in autostash5ec7ad9a4 and overlapping own edits remain in
out/rust-oauth-provider-transaction-overlap.patch. Current main retained the
concurrent original commit, then rebased both commits onto remote refresh/
provenance fixes. Queues e7e507f51 and stored-client76adb8d82 are verified on remote
main. No other changes were reverted or unpublished commits discarded.

Focused lint/types and uncached package build closure are verified for this
integration. Evidence out/rust-oauth-native-queue-provider-*. Original production
imports remain unchanged; this is internal integration inside the additive Rust
package only. Full rewrite/minimum24-hour effort/release publication remain open.

### OAuth Rust registration redirect ownership, 2026-09-21 04:52 UTC

Portable/native reds expose the newer exact registration redirect contract.
Stored clients now retain validated requestedRedirectUri before authentication
admission. Fresh registration matching allows only defined loopback host/port
normalization while preserving scheme, path, query, credentials and fragment;
saved identities remain exact. Rust owns the normalized-component match policy,
while Node supplies WHATWG URL parsing through the existing Rust loopback target
admission. Provider session/client loads use full own registration normalization;
new DCR validates metadata, checks redirect binding and saves exact request identity.
Rust client-cache normalization preserves that field.

All43 Rust cases and13 focused native provider/client groups pass. The maintained
whole native route now passes all76 groups. Its complete original suite fails80/
359 cases across12 files with279 passing; it reaches the original stage but does
not reach the final types stage. Initial/relative grants, namespaces/backend locks,
resource identity, imported registration/configured auth-method and scope binding
remain required fixes. No filtering or complete-unit acceptance is claimed.
Focused lint/fmt/clippy/types and uncached113-workspace/8-build/338-edge closure
pass. Packed artifact/16MiB workers retain the cumulative callback/scope/token/
registration/client/transaction workloads. Evidence out/rust-oauth-stored-redirect-*.

Provider native-queue0d6e36a2b push succeeded; remote verification continues
separately. Root release publication and full goal/minimum24-hour effort remain
unfulfilled. Concurrent original resource-identity work remains untouched.

### Poe agent Rust immutable configuration, 2026-09-21 04:56 UTC

Portable/native reds precede own immutable plugin/MCP/configuration snapshots and
lazy dependency ordering. Rust trims names/model strings, normalizes/deduplicates
both dependency aliases, detects duplicate/unknown/self/cyclic dependencies and
owns iterative DFS frames and stable ordering. Host JavaScript retains callbacks,
property getter/spread semantics, frozen snapshots and recursive schema ownership.
Duplicate names reject before later plugin getters; dependencies are read only
when their plugin is visited. UTF16 error envelopes preserve lone surrogates.
Invalid native planner sequences reject without panicking. A20,000-plugin chain
uses iterative portable frames rather than the original recursive traversal.

All11 Rust cases,16 native groups and82 applicable complete original cases pass.
The reference runtime selection adds the entire runtime/config describe block;
other unfinished describes remain explicitly excluded/unaccounted. Five static
configuration APIs are bidirectionally assignable with original declarations.
Focused lint/fmt/clippy/formatting and uncached113-workspace/28-build/338-edge
closure pass. An initial native attempt overlapped the dependency build and failed
because tiny-mcp-client's reference dist was being rebuilt; the maintained route
was rerun successfully after closure completion. No fixture failure is waived.

Direct/packed16MiB workers each add2048 frozen configurations and2048 ordered
plugin plans to the prior provider/storage/history/tool workloads. Artifact audit
covers26 JS/declaration files, one addon and zero npm runtime groups. Endpoint
heaps~8.2MB and parent-inclusive RSS are workload observations only; no isolated
leak/peak or performance advantage acceptance is claimed. Evidence
out/rust-poe-agent-config-*. Full agent builder/execution/plugins/adapters and the
remaining closure remain unfinished.

OAuth redirect was rebased from8119801c7 toe10fe00c1 after retaining concurrent
credential-lock/profile/corrupt-session fixes. It and provider native-queue
0d6e36a2b are verified on remote main. Root release35562599034 is pending. Minimum
24-hour actual effort and full rewrite/release acceptance remain open; active work
continues from04:34:58 recorded continuation boundary.

### Poe agent Rust file awareness, 2026-09-21 05:01 UTC

Native red precedes ordered, deduplicated Rust file-awareness sets and exact file
operation admission. Hosts supply platform path.resolve and original property/
callback effects. Snapshots own independent read/modified Sets, preserving UTF16,
relative/absolute paths, insertion order and inherited path getters. Invalid or
blank paths do not read the tool getter. Tool getters retain the original staged
read_file/write_file/edit checks rather than being evaluated eagerly once.

All12 Rust cases,18 native groups and84 applicable original cases pass; the
reference route adds the complete2-case file-awareness test file. Two static
awareness APIs compare bidirectionally with original declarations. Focused lint/
fmt/clippy/formatting and uncached113-workspace/28-build/338-edge closure pass.
The initial portable test contained an invalid Rust Unicode escape; it was fixed,
and all maintained checks pass, without counting compiler rejection as behavioral
conformance. Rust shares immutable path buffers between ordered storage and its
membership index, and accepts borrowed paths to avoid duplicate buffer copies
when already present. This is an implementation allocation reduction, not evidence
of lower total memory than the original.

Direct/packed16MiB workers each add8192 reads and8192 writes, checking128/64 unique
paths and independent snapshots, to prior provider/storage/history/tool/config
workloads. Artifact audit covers28 JS/declaration files, one addon and zero npm
runtime groups. Endpoint heaps/RSS remain workload evidence. The explicit speed
gate fails: after four warmups, seven alternating rounds of16384 reads and16384
writes across128 unique paths take original~8.6–8.8ms vs Rust~10.9–11.3ms. Binding
crossings still outweigh this small policy workload; no speed advantage acceptance
is claimed. Evidence out/rust-poe-agent-awareness-*.

Configuration ea739d625 was rebased to4b486325a, pushed within concurrent
b1b341245, and verified on remote main. Root release35562846218 is pending.
Conservative continuous active04:34:58–05:01:42 adds1604s, bringing recorded actual
effort to84,585s (23.50h). Minimum24-hour effort remains unfulfilled by1815s;
full agent/runtime/closure rewrite and successful root publication remain open.
Work continues beyond05:01:42 UTC boundary.

### Poe agent Rust hooks and decisions, 2026-09-21 05:08 UTC

Portable/native reds precede own hook callback catalogs, first-defined-decision
pipelines, staged decision plans and warning state. Rust derives the ten event
names, retains live registration order, copies catalogs, selects the first defined
opaque result while running every callback, applies event-specific skip policy and
short-circuits reject/block/rewrite/replace/input predicates. The staged planner
preserves repeated property reads, changing getter values and inherited args.
Host Node retains callback/context/patch identity, WeakMap disposal associations,
async effects, original context projections, logging and AbortError causes.

All15 Rust cases,22 native groups and102 applicable complete original cases pass.
Reference selection adds whole HookRegistry, hook context factories and
applyHookDecision describes; remaining execution describes stay excluded/unaccounted.
Public registry methods compare types excluding nominal copyFrom, and decision/
context APIs compare with original declarations. Private-field copies require the
same implementation, explicitly disclosed. Focused lint/fmt/clippy/formatting and
uncached113-workspace/28-build/338-edge closure pass. Direct/packed16MiB workers
each add2048 callbacks and2048 decisions to prior foundation workloads. Artifact
audit covers30 JS/declaration files, one addon and zero npm runtime groups. Endpoint
heaps~8.5MB and parent-inclusive RSS are workload observations only. No isolated
leak/peak or performance advantage acceptance is claimed. Evidence
out/rust-poe-agent-hooks-*. Hook microbenchmarks are recorded separately.

File-awareness a6401cb12 is pushed and verified on remote main. Root
release35563113958 is in progress; no successful root publication is claimed.
Prompt pipelines, RunContext disposal/lifecycle, plugin setup, agent builder and
execution/runtime/remaining closure are required next. Full goal and minimum
24-hour effort remain open; work continues from05:01:42 ledger boundary.

### Poe agent Rust prompt transforms, 2026-09-21 05:13 UTC

Portable/native reds precede live Rust callback ordering and own PromptRegistry.
Sequential transforms retain opaque extension properties and arbitrary callback/
getter failures, restore original userPrompt after every transform and include
registrations made during compilation. Callback invocation retains undefined this.
Copies snapshot the source before appending, including self-copy, and require the
same private-field implementation. Offset overflow rejects atomically in the core.

All16 Rust cases,24 native groups and109 applicable complete original cases pass.
The reference route adds the entire7-case PromptRegistry describe; no unfinished
execution describes count as passes. Public-method declarations compare both ways
excluding nominal copyFrom. Focused lint/fmt/clippy, maintained uncached113-workspace/
28-build/338-edge closure and packed artifact checks pass. A preliminary unit run
included the intentionally missing RunContext native test; those own pending reds
were moved to out until this atomic prompt improvement was validated successfully.
Direct/packed16MiB workers each add1024 compiles and2048 transforms. Audit covers32
JS/declaration files and one addon, with zero npm runtime/peer/optional dependencies.
Endpoint heaps~10.5–10.8MB and parent-inclusive RSS do not establish peak/leak/memory
advantage. Prompt speed gate fails:4096 compiles/8192 callbacks over seven alternating
rounds take original~0.71–0.89ms vs Rust~1.72–1.84ms. Earlier hook speed gate also
fails:4096 dispatches/8192 callbacks original~1.69–1.82ms vs Rust~9.29–10.52ms.
Evidence out/rust-poe-agent-prompts-* and out/rust-poe-agent-hooks-benchmark.json.

Hook62cba4691 is pushed and verified at remote main; root35563539781 remains pending.
Continuous active05:01:42–05:13:02 adds680s, bringing conservative actual effort to
85,265s (23.68h). Minimum24h remains unfulfilled by1135s. Full rewrite and root
publication remain incomplete. Active work continues after05:13:02 UTC.

### Poe agent Rust run contexts, 2026-09-21 05:16 UTC

Portable/native reds precede own RunContext construction and Rust disposal ordering/
retirement. Public messages/session/MCP/skills/child collections, callbacks, abort
controllers and injected file trackers retain host identity/mutation. Child promises
are returned unchanged and removed on either settlement. Rust retains registration
handles, supplies reverse attempts and restores only failed handles in registration
order. Node coalesces concurrent attempts, preserves arbitrary AggregateError causes,
logs every failure and releases successful callbacks after a completed attempt.
Logger failures occur before survivor replacement, preserving original hooks for
retry. Abort-listener registrations are captured; later in-flight additions retire
with the original final replacement. Successful disposal is idempotent. The original
reentrant abort-listener disposal race is not claimed as independently fixed.

All17 Rust cases,27 native groups and117 applicable complete original cases pass.
Reference selection adds the entire8-case RunContext describe. Public state/method/
option types compare bidirectionally excluding nominal tools/prompts/hooks classes.
Focused lint/fmt/clippy/formatting pass. The first build used16 shared cache hits;
it was explicitly rerun with --no-cache, producing the maintained113-workspace/
28-build/338-edge closure, then the complete package unit route passed again.
This uncached closure also verifies the prior prompt sources; the prior prompt log
had zero hits but did not disable caching explicitly. Direct/packed16MiB workers
each add1024 run contexts/disposals and2048 callbacks, with child tracking and
concurrent/idempotent cleanup. Audit covers34 JS/declaration files and one addon,
with zero npm runtime/peer/optional dependencies. Endpoint heaps~7.8MB and parent-
inclusive RSS establish no isolated leak/peak/memory advantage. Speed gate fails:
2048 contexts/4096 callbacks original~5.16–6.12ms vs Rust~11.34–14.30ms over seven
alternating rounds. Evidence out/rust-poe-agent-run-context-*.

Prompt147ace956 is pushed and verified at remote main. Root35563805220 remains
pending; no successful current root publication is claimed. Full current OAuth
reference route is running after concurrent credential/resource fixes. Continuous
active05:13:02–05:15:58 adds176s, bringing conservative effort to85,441s (23.73h).
Minimum24h remains unfulfilled by959s, and full agent/closure rewrite remains open.
Work continues after05:15:58 UTC.

### Poe agent Rust structured tool results, 2026-09-21 05:23 UTC

Portable/native reds precede Rust short-circuit part admission and own six result
helpers. Typed text/image/error parts retain host identity. Empty/sparse arrays,
opaque values, JSON serialization hooks, fallback conversion and undefined
serialization outcomes match the reference. Repeated/changing/inherited type
getters retain original read order; arbitrary thrown values propagate unchanged.
Image labels preserve UTF16. Host serialization intentionally retains original
JSON.stringify/String effects rather than introducing stricter protocol admission.

All18 Rust cases,29 native groups and117 applicable complete original cases pass.
The six result helper declarations compare bidirectionally. No additional original
SDK cases are counted: the source has no dedicated result-helper describe/file;
native groups cross-check the actual source directly. Focused lint/fmt/clippy,
formatting and uncached113-workspace/28-build/338-edge closure pass. Final getter/
large-type regression also passes. Packed/direct16MiB workers each add8192 probes
and8192 normalizations; audit covers36 JS/declaration files and one addon with zero
npm runtime groups. Endpoint heaps~10.4MB and parent-inclusive RSS do not establish
isolated leak/peak/memory advantage.

Performance gate fails substantially:16384 normalizations/49152 parts original
~0.30–0.46ms vs final Rust~12.51–13.83ms over seven alternating rounds. A callback
adapter took~11.77–12.02ms, so replacing callback crossings did not establish a
speed advantage. The retained direct binding avoids per-probe callback closures,
property-name CString allocations and arbitrary-length UTF16 type copies: static
CStr names and VM strict equality compare type literals without copying input.
This is an allocation/property-effect design choice, not a demonstrated speed or
total-memory win. Complete Rust execution must amortize binding boundaries; current
small exported policies fail performance acceptance. Evidence
out/rust-poe-agent-tool-results-*.

RunContext147cae1e5 is pushed; root publication remains unverified. Refreshed OAuth
baseline has326/367 original cases pass,41 fail across7 files; native groups pass.
Auth-method policy work now reduces failures to28 across5 files (339/367 pass),
including all11 token-auth-provider cases, but full OAuth acceptance remains open.
Continuous active05:15:58–05:22:35 adds397s, bringing conservative effort to85,838s
(23.84h). Minimum24h remains unfulfilled by562s. Full rewrite remains incomplete;
active work continues after05:22:35 UTC.

### OAuth provider token authentication, 2026-09-21 05:24 UTC

Portable and original SDK reds precede Rust authentication method admission,
bounded discovery method lists, registration selection and cached method-profile
checks. Dynamic registration prefers none/basic/post in that order; explicit
methods reject when unadvertised. Confidential methods require a secret. Host
provider propagates methods through code exchange/refresh, including fresh DCR
methods, and treats full imported registrations as configured static ownership.
Public-client methods never send an available secret. Options reject unsupported
methods at creation. Authentication checks precede pending refresh persistence
and interactive token exchange. Existing registration metadata and own extension
ownership are retained.

All45 Rust cases and77 native groups pass. Entire token-auth-provider11-case and
registration-metadata19-case reference files pass (30/30); declarations compile.
Focused maintained build/lint/fmt/clippy/formatting and direct/packed artifact checks
pass. Full maintained unit route remains failing:339/367 original cases pass,
28 fail across5 files. Required residuals cover scope, secret expiry/registration
issuer trust, obsolete redirect replacement, resource identity and explicit
OAuth interaction. No full provider acceptance is claimed. Direct/packed16MiB
workers each add12,288 authentication policies to prior workloads, with zero
runtime dependency groups and one addon. Endpoint memory is workload evidence,
not isolated leak/peak/advantage proof. Evidence out/rust-oauth-provider-auth-*.

Agent result41ec2ca65 is pushed and verified within concurrent original main work.
Root35564374719 remains pending; current root publication is unverified. Continuous
active05:22:35–05:23:55 adds80s, bringing conservative effort to85,918s (23.87h).
Minimum24h remains unfulfilled by482s; full rewrite remains open. Active work
continues after05:23:55 UTC.

### OAuth provider scope isolation, 2026-09-21 05:28 UTC

Portable and original SDK reds precede Rust cached/refresh/authorization scope
profile gates. Profiles compare normalized case-sensitive sets; cached tokens
fallback to stored requestedScope when granted scope is missing. Refresh retains
the previous scope when omitted, rejects broader/narrower/differently-cased grants
without replacing the pending-outcome marker, and preserves rotating token fallback.
Code exchange rejects an explicitly different supplied scope. Host snapshots
normalized client name/scope/software metadata at provider construction, preserving
source property-read order; later caller mutation cannot change the requested scope.

All46 Rust cases and77 native groups pass. Complete scope-isolation19-case file,
token-auth-provider11 and registration-metadata19 files pass (49/49). Own type
fixtures, focused maintained build/lint/fmt/clippy/formatting and packed checks pass.
Full maintained unit route remains failing:347/373 original cases pass,26 fail
across4 files. During work the original resource-identity suite added6 cases; its
required storage rewrite remains unfinished. Interaction has3 explicit authenticate
failures, with its broader-code-exchange and captured-scope cases now passing.
Issuer/expired-secret trust and obsolete redirect replacement remain required.
No complete provider acceptance is claimed. Direct/packed16MiB workers each add
12,288 scope gates to prior workloads, checking exact normalized sets, rejected
refresh widening and omitted exchange scope. Audit covers19 JS/declaration files,
one addon and zero runtime dependency groups. Endpoint heaps~14MB and parent-
inclusive RSS are not isolated leak/peak/advantage evidence. No scope speed advantage
is claimed. Evidence out/rust-oauth-provider-scope-*, including a mixed scope/
interaction run that correctly retains the3 required authenticate failures.

Authentication7ab4a11d8 is pushed. Root35564441063 remains pending; publication
remains unverified. Continuous active05:23:55–05:28:09 adds254s, bringing conservative
effort to86,172s (23.94h). Minimum24h remains unfulfilled by228s; full rewrite remains
incomplete. Active work continues after05:28:09 UTC.

### Poe agent Rust session history reconstruction, 2026-09-21 05:33 UTC

Portable/native reds precede Rust branch identity/traversal and staged entry-kind
classification, with own collectBranch/findHead/buildMessages exports. Latest
sample duplicate IDs win; original entry references survive; sibling parents remain
unread. Node captures map-time entry references and retains tool intent association,
args serialization hooks/errors, opaque multimodal result arrays and compaction
formatting. Native traversal runs within one call; parent/kind getter failures retain
arbitrary causes. Invalid native input lengths reject rather than panic. Kind getters
retain original repeated/changing comparisons. Source references compile both ways.

Repeated branch IDs reject with a cycle error instead of retaining an unbounded
history. This intentional additive safety difference also rejects a parent getter
that deliberately revisits an ID before eventually terminating. It is disclosed,
not counted as parity with the original infinite-cycle behavior. Portable branch
indices can own names or borrow ingress slices; the napi traversal borrows native
UTF16 buffers to avoid a second per-name owned copy. Borrowed lookup/cycle reds and
native regression checks pass. Remaining full execution/agent/plugins are pending.

All20 Rust cases,33 native groups and120 applicable complete original cases pass.
The reference route adds the entire3-case session-tree file. An initial expected
JSON escape used a literal backslash rather than the intended lone surrogate; that
fixture was corrected and the complete maintained route passes, without treating a
fixture failure as source parity. Focused lint/fmt/clippy/formatting and uncached
113-workspace/28-build/338-edge closure pass; package tests rerun after closure.
Direct/packed16MiB workers each add1024 branch collections and1024 reconstructions
of32 entries. Audit covers38 JS/declaration files, one addon and zero npm runtime
groups. Endpoint heaps~9.8MB and parent-inclusive RSS establish no isolated leak/
peak/memory advantage. Speed gate fails:1024 reconstructions/32768 entries over
seven alternating rounds original~1.07–1.14ms vs final Rust~11.10–12.66ms. The earlier
owned-copy variant had original~1.39–1.72ms and Rust~14.72–16.62ms; changed process/
round conditions prevent attributing the difference solely to borrowed ingress.
Evidence out/rust-poe-agent-session-tree-*.

Scopef8cfebb14 is pushed and verified at remote main. Root35564678720 is pending;
no successful current root publication is claimed. Concurrent original suites
continue expanding. Current OAuth registration trust work has359/378 original cases
pass;19 required failures across explicit authenticate/resource-identity files
remain. Continuous active05:28:09–05:33:23 adds314s, bringing conservative actual
effort to86,486s (24.02h). The minimum24-hour effort requirement is fulfilled, but
the full rewrite/performance/memory/platform/release acceptance is NOT achieved.
Active implementation continues after05:33:23 UTC.

### Scope lint evidence correction, 2026-09-21 05:35 UTC

The earlier scope checkpoint incorrectly described focused lint as passing: its
initial log contains clippy collapsible-if failures, which were not inspected
before that commit. The tests/build/types evidence still passes. Collapsed the two
scope conditions without changing short-circuit order, fixed the same condition
in pending registration trust code, and reran the complete maintained Rust lint
route successfully (out/rust-oauth-provider-registration-lint.log). No lint failure
is waived. The corrective scope change is committed separately from registration
trust implementation. Minimum24h is fulfilled; full rewrite remains incomplete.

### OAuth registration trust and durable ownership, 2026-09-21 05:40 UTC

Portable and original SDK reds precede exact issuer admission, lazy client-secret
expiry facts and registration replacement gates in Rust. Stored/imported/fresh DCR
issuer mismatches reject before persistence/token submission. Known expired secrets
reject headless refresh; interactive authorization can replace native-owned expired
or obsolete registrations. Public/unlimited/unknown expiry does not invoke the clock.
Live access tokens remain usable without submitting an expired secret.

Concurrent original changes added durable registrationOwnership and5 related
regressions while this improvement was pending. Rust admission now preserves the
caller marker only with a complete registration and rejects invalid ownership.
Configured imports acquire caller ownership, retained through native normalization,
persisted sessions and registration caches. Existing caller registrations take
precedence over native replacement, require explicit expiry/callback updates and
remain cached after invalid_client refresh failures. Original property effects,
arbitrary ownership getter causes and recursive extension ownership cross-check.

All48 Rust cases and79 native groups pass. Entire registration-binding/redirect/
metadata, token-auth-provider and scope-isolation files pass92/92 cases after fresh
original SDK builds. Full maintained package unit route still fails:369/388 original
cases pass,19 fail in explicit authenticate/resource-identity files. Focused lint/
fmt/clippy/formatting, declarations and maintained uncached113-workspace/8-build/
338-edge closure pass. Public registration/method options, pending refresh state,
scope and client ownership declarations now expose implemented behavior. New typed
usage fixtures first failed for missing registration fields, then passed after the
own declarations were updated; a preliminary pre-build type run read stale dist
and was rerun after closure. Removed the duplicate weaker withLock overload.

Direct/packed16MiB workers each add24,576 registration trust/ownership operations
to prior workloads. A preliminary worker record omitted registration client_id and
secret before ownership normalization; the valid fixture was corrected and both
artifact routes pass. Audit covers19 JS/declaration files, one addon and zero npm
runtime groups. Endpoint heaps~11.7–11.8MB and parent-inclusive RSS establish no
isolated leak/peak/memory advantage; no speed acceptance is claimed. Evidence
out/rust-oauth-provider-registration-*.

Agent session4acbe53b4 and scope-lint correction1aa19b7bb are pushed and verified on
remote main. Root35565119728 is in progress; successful publication remains
unverified. Continuous active05:33:23–05:40:22 adds419s, bringing conservative actual
effort to86,905s (24.14h). Minimum effort is fulfilled; full rewrite/performance/
memory/platform/release acceptance remains incomplete. Work continues after
05:40:22 UTC.

### OAuth explicit authentication, 2026-09-21 05:44 UTC

Native and original SDK reds precede own provider.authenticate and declarations.
It reuses the portable/native shared session-flow engine for grant recovery,
refresh and consent. Host glue invokes lazy discovery only when no usable known
grant exists, verifies discovery/resource binding before consent, preserves abort
causes and returns independent cached/imported/established token snapshots. Calls
without discovery recover known grants only. No rejected response/request is
fabricated. Existing allowInteractive and initial-grant consumption gates remain.

All48 Rust cases,81 native groups and all12 original oauth-interaction cases pass.
Focused lint/fmt/clippy/formatting, typed authenticate usage, maintained uncached
113-workspace/8-build/338-edge closure and direct/packed artifact checks pass.
Initial full SDK execution collided with another reference dependency rebuild and
could not load toolcraft-schema for2 suites; it was rerun after closure. All35
source test files now execute. Concurrent source additions introduced raw token
import/resource session import test files and expanding validation cases. The full
maintained unit route remains failing:372/431 cases pass,59 fail across resource
identity(16), resource import(15) and token grant(28). Those own rewrites are
required next; no provider/full package acceptance is claimed.

Direct/packed16MiB workers each add1024 explicit cached authentications, checking
lazy discovery/network avoidance and independent token snapshots. Audit covers19
JS/declaration files, one addon and zero runtime groups. Endpoint heaps~14.2–14.4MB
and parent-inclusive RSS establish no isolated leak/peak/memory advantage. No
speed advantage is claimed. Evidence out/rust-oauth-authenticate-*.

Registration trust9efe9596e is pushed and verified within concurrent original token
parser429e0ee45 work. Root release remains pending/in progress; successful current
publication remains unverified. Continuous active05:40:22–05:44:27 adds245s, bringing
conservative effort to87,150s (24.21h). Minimum effort is fulfilled; full rewrite and
acceptance remain incomplete. Active work continues after05:44:27 UTC.

### OAuth bounded credential JSON, 2026-09-21 05:52 UTC

Portable/native reds precede reusable generic credential admission and owned copies.
Descriptor ingress rejects accessors, functions, class instances, holes, cycles and
excessive depth/values without invoking serialization or accessor hooks. String and
enumerable-key UTF16 lengths are checked before copying; cumulative ingress cannot
exceed65,536 units. Non-enumerable keys/values remain ignored. Complete portable
serialized admission enforces64KiB UTF8 before registration field diagnostics,
fixing the reproduced oversized missing-client error precedence.

All49 Rust cases and83 native groups pass. Focused lint/fmt/clippy, own types,
maintained uncached113-workspace/8-build/338-edge closure and direct/packed16MiB
workers pass. Each artifact worker adds4096 independently owned credential copies
and oversized rejection. Audit20 JS/declaration files, one addon, zero npm runtime
groups. Endpoint heaps~11.7MB; parent-inclusive RSS establishes no peak/leak/memory
advantage. No performance acceptance is claimed. Evidence
out/rust-oauth-credential-json-*.

The complete original SDK unit route still fails:372/437 cases pass,65 fail.
Concurrent original HTTP cancellation fixes introduced6 additional required cases
besides resource identity(16), resource import(15), token grants(28). Those are
required next, without waiving failures. Earlier commentary59-failure count was
from the preceding baseline; this rerun establishes65.

Explicit authentication3ba1decad is pushed. Current successful root publication
remains unverified. Continuous active05:44:27–05:52:38 adds491s, bringing conservative
actual effort to87,641s (24.34h). Minimum24h is fulfilled; full rewrite/acceptance
remain incomplete. Active work continues after05:52:38 UTC.

### OAuth host fetch cancellation, 2026-09-21 05:54 UTC

Native reds reproduce pending cancellation when injected fetch ignores its signal
and host invocation after pre-cancellation. The own host adapter now races request
completion against cancellation, preserves arbitrary abort causes, observes late
rejections, cancels late bodies and removes abort listeners on success/failure/abort.
Rust still owns redirect admission; Node must own host promises and cancellation.

All49 Rust cases and85 native groups pass. All8 complete original HTTP fetch cases
pass. Maintained complete unit route remains failing only for59 required missing
resource identity/import/token grant cases:378/437 pass. Focused maintained lint,
types, uncached113-workspace/8-build/338-edge closure and direct/packed16MiB workers
pass. Each worker adds1024 cancelled host requests, independent late body disposal
and listener-retirement assertions to prior workloads. No memory/performance
advantage claimed. Evidence out/rust-oauth-http-cancel-*.

Credential admission083ac18f7 is pushed within concurrent original e8beba756; the
original credential-import improvement is another author's work. Current root
publication remains unverified; a later gh run list unexpectedly returned historical
September4 runs and is not evidence of successful current release. Continuous active
05:52:38–05:54:27 adds109s, bringing conservative actual effort to87,750s (24.38h).
Minimum effort fulfilled; full rewrite/acceptance incomplete. Continue after
05:54:27 UTC.

### OAuth raw token imports, 2026-09-21 05:57 UTC

Portable/native and complete original SDK reds precede public parseOAuthTokenGrant,
its own declarations and direct-module reference redirect. The Rust core admits
bounded JSON without invoking credential accessors/serialization, trims required
access/optional refresh values, enforces Bearer, validates all supplied safe-integer
timing fields and normalizes nonempty supplied scopes. It retains only relevant
fields after admission, rather than holding a second full extension tree. Node
Headers enforces compatible credential header admission before timing evaluation.

Staged native effects preserve option getter order, callback error identity, host
addition semantics and timing-error precedence. Absolute milliseconds/seconds
retain precedence while every overridden relative/absolute field still validates.
Clock callbacks run once only for relative lifetime without issuedAt. Unlimited
imports avoid the clock. All51 Rust cases,86 native groups and all28 original raw
grant cases pass. Bidirectional declaration usage, lint/fmt/clippy and maintained
uncached113-workspace/8-build/338-edge closure pass. Complete package unit route
still fails31 required resource identity/import cases:406/437 pass.

Direct/packed16MiB workers each add8192 token imports to cumulative workloads. Audit
21 JS/declaration files, one addon and zero npm runtime groups. Endpoint heap~10.2–
11.1MB and parent-inclusive RSS establish no peak/leak/memory advantage. Five
alternating warmed4096-import rounds measure original~9.49–13.84ms, Rust~22.25–
25.50ms: this boundary-heavy small API fails the speed gate. No full package or
performance acceptance claimed. Evidence out/rust-oauth-token-grant-*.

Host cancellation03eea691e is pushed. Successful current root publication remains
unverified. Continuous active05:54:27–05:57:48 adds201s, bringing conservative actual
effort to87,951s (24.43h). Minimum effort fulfilled; full rewrite/acceptance
incomplete. Continue active work after05:57:48 UTC.

### OAuth durable resource identities, 2026-09-21 06:03 UTC

Portable and complete original SDK reds precede Rust-owned document admission,
generation history, session/client ownership and retirement. Native state serializes
its own document, retains the same URL, retires grants/registrations on a URL change,
refuses generation overflow without changing state and preserves tombstones on
reversion/clear/reset. Node provides URL semantics, encrypted storage and raw locks.
Peeks leave history untouched; only transaction owners reconcile URL changes.
Explicit reset bypasses corrupt reads but writes under the same stable backend lock.
Namespaces/identities keep independent filenames/accounts.

Own provider.resourceIdentity selects its own stores, rejects custom persistence,
clears native registration caches within every locked transition and suppresses
environment replay after retirement. Existing session admission also now rejects
contradictory pending-refresh tokens, empty requestedScope and mismatched registration
identity after a concrete failing portable regression. Owned runtime defaults/hash
are reused by the generalized named secret-store implementation.

All54 Rust cases pass; all7 focused native identity/session groups and all21 original
identity cases pass. Types, lint/fmt/clippy, maintained uncached113-workspace/8-build/
338-edge closure and direct/packed16MiB workers pass. Each worker adds12,288 identity
transitions with serialization/reload and registration/replay retirement assertions.
Audit22 JS/declaration files, one addon, zero runtime groups. Endpoint heap~8.5–11.8MB
and parent-inclusive RSS establish no peak/leak/memory advantage. No speed claim.

The maintained complete unit route fails2/88 native groups because concurrent
original token-error classification changed; those failures are not waived and will
be reconciled next. Separate complete original cross-check executes all35 files,
423/451 cases pass,28 fail: token-endpoint9, registration-lifecycle4, resource-import15.
Original source added14 cases during this improvement. Atomic session import and
updated endpoint errors remain required; full package acceptance incomplete. Evidence
out/rust-oauth-resource-identity-*.

Raw import9b3c9c215 is pushed. Concrete root35565724263 was cancelled and its release
job skipped. API inspection finds current root35566511319 pending and earlier
35566225666 in progress; no successful current publication verified. Continuous
active05:57:48–06:03:20 adds332s, bringing conservative actual effort to88,283s
(24.52h). Minimum effort fulfilled; full rewrite/acceptance incomplete. Continue
active work after06:03:20 UTC.

### OAuth malformed endpoint error admission, 2026-09-21 06:05 UTC

Concrete native/original SDK failures and a portable red precede reconciliation
with evolving original endpoint/registration rejection behavior. Rust classifies
malformed responses by status:503 temporarily_unavailable, other5xx server_error,
lower statuses invalid_response. It discards malformed error diagnostic fields,
retains unknown outcome and does not echo rejected body credentials. Node errors
use a generic HTTP-status message for unknown outcomes, preserve own-field aliases
and avoid rereading shape.error to classify retries. Non-OAuth4xx registration
errors terminate without another DCR attempt or consent wait.

Earlier own native cases hardcoded superseded fallback messages/server_error and
even failed against the updated original. Updated those assertions to the current
independently checked contract, retaining malformed UTF8/pollution/size/abort
coverage and adding outcomeKnown to differential projections. All55 Rust cases,
88 native groups and all32 complete token-endpoint/registration-lifecycle source
cases pass. Maintained full unit route now reaches all35 original files:436/451
pass,15 required resource-import cases fail. Full package acceptance remains
incomplete. Focused lint/fmt/clippy/types, uncached maintained closure and packed/
direct16MiB workers pass; workers each add4096 malformed error admissions.
Audit22 files, one addon, zero runtime groups. No memory/performance advantage
claimed. Evidence out/rust-oauth-response-errors-*.

Identity3daf42cdf is pushed. Current root35566847112 pending; previous35566511319
cancelled. No successful current publication verified. Continuous active
06:03:20–06:05:48 adds148s, bringing conservative actual effort to88,431s (24.56h).
Minimum effort fulfilled; full rewrite/acceptance incomplete. Continue active work
after06:05:48 UTC.

### OAuth atomic named-session imports, 2026-09-21 06:08 UTC

Portable/native and all15 original source reds precede Rust import admission,
resource/issuer/registration binding, caller ownership, canonical resource updates
and one document replacement. Descriptor ingress and full serialized bounds own
the complete credential tree before any lock wait without invoking credential
accessors/serialization. Rust constructs generation1 with the imported client and
grant together. Node checks compatible URL/header semantics and uses the same raw
stable identity lock as refresh/reconciliation/reset. Explicit replacement bypasses
corrupt old reads; cancelled lock waiters do not mutate credentials.

The complete maintained package unit route PASSES:all56 Rust cases,89 native groups,
all451 original cases across35 files and types. Focused complete15-case import
cross-check, bidirectional resource-store declarations, lint/fmt/clippy, maintained
uncached113-workspace/8-build/338-edge closure and direct/packed16MiB workers pass.
Each artifact worker adds4096 owned session imports, caller ownership, tombstone
reload and post-admission mutation assertions to cumulative workloads. Audit22
JS/declaration files, one addon, zero npm runtime groups.

Endpoint heap~11.5–11.7MB and parent-inclusive RSS~184–201MB do NOT establish a
peak/leak/memory advantage. RSS increased after import workload; native reclamation
and isolated repeated-process/GC stability require investigation next. Broad SDK/
E2E/platform/performance acceptance remains incomplete even though current original
unit conformance is complete. Evidence out/rust-oauth-resource-import-*.

Endpoint rejectiond41f9eca8 is pushed. Current root35566988189 pending; independent
tiny-http35566987998 succeeds but does not publish private Rust packages. No successful
current root publication verified. Continuous active06:05:48–06:08:38 adds170s,
bringing conservative actual effort to88,601s (24.61h). Minimum effort fulfilled;
full rewrite/acceptance incomplete. Continue active work after06:08:38 UTC.

### OAuth root surface and isolated reclamation, 2026-09-21 06:11 UTC

A native root-export audit reproduces missing normalizeOAuthScope; a typed public
usage red also reproduces missing ImportedOAuthTokens. Added the root scope export,
its own declaration and the imported-token interface, replacing equivalent inline
initial-grant declarations with the public type. The runtime audit compares every
original export and a development AST audit checks every named original public type.
All56 Rust cases,91 native groups,451 original cases/35 files and typed usage pass
through the maintained complete unit route. Focused maintained lint and own build
pass. Direct/packed16MiB cumulative worker audit remains22 files, one addon, zero
runtime groups and passes; no performance advantage claimed.

Isolated native import processes with16MiB Node old-space each exercise98,304 small
imports. Automatic collection/yield RSS endpoints rise~80.2→84.3MB and settle near
84.3MB for the final batches; heap~4.0–5.0MB. Forced four-collection/yield batches
show RSS~80.4→85.4MB, post-GC heap~3.85–3.89MB, fixed external/array-buffer endpoints.
A separate4096-import60KB-extension process samples RSS~62.9→88.3MB with post-GC
~88.7MB and heap~3.93MB. These finite workloads support reclamation rather than
linear unreclaimed growth; allocator/VM retention remains and external counters
do not account for all Rust allocations. No universal leak/peak/TS memory advantage
acceptance follows. Evidence out/rust-oauth-resource-import-{reclamation,automatic-
gc,large-memory}.* and out/rust-oauth-public-api-*.

Atomic import94cfa4578 is pushed. Root35567221359 in progress; current successful
publication unverified. Continuous active06:08:38–06:11:35 adds177s, bringing
conservative actual effort to88,778s (24.66h). Minimum effort fulfilled; full
rewrite/acceptance incomplete. Continue active work after06:11:35 UTC.

### Poe agent ACP replay and transcripts, 2026-09-21 06:19 UTC

Portable and complete original transcript-file reds precede generic Rust update
templates and staged event classification. The native mapper retains opaque JS
argument/result references, repeated type/id/content getters, arbitrary getter
causes, usage metadata, NaN and positive-zero clamp behavior. Node supplies length
and subtraction expressions to preserve VM coercion and BigInt failure ordering.
Own data properties avoid prototype setters. Host JSON serialization preserves
cycles/custom hooks/causes after path admission; injected filesystem adapters retain
original mkdir caching, symlink checks, append failures/retry and close semantics.
Shipped ACP declarations are embedded from the own ACP Rust package’s maintained
type source, without runtime imports.

Initial build exposed a napi-rs macro lifetime restriction and a mistaken declaration
source-relative path; both corrected. Original usage/native differential cases then
reproduced callback receiving one tuple array rather than two arguments. FnArgs
corrects actual callback argument semantics. Final maintained package checks pass:
22 Rust cases,35 native groups,138 applicable complete original cases across8 files,
including all18 transcript cases. Bidirectional own/reference transcript declarations,
lint/fmt/clippy, maintained uncached113-workspace/28-build/338-edge closure and direct/
packed16MiB cumulative workers pass. Each worker adds16,384 mapped updates and512
serialized writes. Audit41 JS/declaration files, one addon, zero runtime groups.
Endpoint heap~8.9–9.4MB and parent-inclusive RSS establish no peak/leak/memory advantage.
Warmed five alternating8192 mappings measure TS~0.15–0.73ms, native~13.46–14.62ms;
small template mapping fails the speed gate. Full agent execution/integration and
broader acceptance remain incomplete. Evidence out/rust-poe-agent-transcript-*.

Root API0b2a5e7d4 is pushed. Root35567221359 FAILED its build job, release skipped: new
OAuth grant/resource binding modules refer to crate::registration_binding, which
does not exist when embedded under client modules in the combined HTTP addon.
This is an own portability defect, not waived. A focused maintained combined build
red is running; relative sibling imports are the next atomic fix. Current root
35567435784 in progress; no successful current publication verified. Continuous
active06:11:35–06:19:34 adds479s, bringing conservative actual effort to89,257s
(24.79h). Minimum effort fulfilled; full rewrite/acceptance incomplete. Continue
active work after06:19:34 UTC.

### Embedded OAuth portability, 2026-09-21 06:26 UTC

Maintained combined HTTP build red reproduces the release defect. Relative sibling
imports repair grant/resource bindings when nested beneath the embedded client.
Explicit provider import and maintained HTTP suite reds also reproduce a missing
credential-transaction-lock module. HTTP preparation now embeds the own lock next
to auth-store runtime; recursive fixture embedding includes it. Uncached family
closure passes113 workspaces/16 builds/338 edges. Explicit HTTP/fixture provider
imports pass. Maintained HTTP checks pass26 Rust cases,48 native groups,443 reference
cases/21 files and bidirectional types. Focused OAuth/HTTP lint passes. Fixture checks
pass5 Rust cases,3 native groups,23 reference cases/4 files and types. Direct/packed
16MiB fixture workers each pass32 listener/PKCE flows,2048 echo calls,32 revocations
and CLI help. No runtime dependencies added. Evidence out/rust-oauth-embedded-*.

HTTP lifecycle reds expose development SDK divergence: originals resolve1.30 while
the own package pins1.29. Development-only Vite deduplication and TypeScript paths
resolve both contract sides against root SDK, restoring actual cleanup mocks and
shared nominal SDK types. Client checks independently expose four newly added
initialization-completion failures; separate correction underway.

Remote main80912d7d3 includes transcript work; root35568021206 remains in progress.
Root35567435784 failed; no successful current publication verified. Continuous
active06:19:34–06:26:57 adds443s, bringing conservative effort to89,700s (24.92h).
Minimum fulfilled; full rewrite/acceptance incomplete. Continue after06:26:57 UTC.

### OAuth JSON endpoint negotiation, 2026-09-21 06:28 UTC

Concurrent originals add Accept:application/json on registration/token endpoints.
The maintained seeded Unicode differential red detects the missing own header;
complete updated reference tests also exercise endpoints requiring negotiation.
Own registration/token host adapters now advertise JSON. Maintained OAuth checks
pass56 Rust cases,91 native groups,456 reference cases/35 files and types; focused
lint and uncached combined fixture closure pass. Fixture direct/packed workers
exercise the embedded adapter with zero runtime groups. No speed advantage claimed.
The previous HTTP portable-case total was a transcription error:25 cases, not26.
Embedding9d8badee5 push completed; publication remains unverified.
