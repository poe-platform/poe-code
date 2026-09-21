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

### MCP legacy initialization completion, 2026-09-21 06:31 UTC

All four new original completion contracts reproduce early connect success,
unobserved notification rejection and lost cancellation/deadline. Own HTTP transport
now completes the initialized POST with the connection signal/deadline; custom
transports retain the optional completion hook and ordinary notification fallback.
HTTP completion failures carry rpcMethod=notifications/initialized. Native readiness
red additionally proves Rust reported ready during a stalled POST. Rust now owns
separate result admission and generation-checked completion, remaining initializing
until the handshake succeeds; stale/closed completions reject. Arbitrary cancellation
causes survive even when injected fetch never settles or observes abort. Native
failure expectations were corrected against original disconnected recovery state.

Maintained checks pass33 Rust cases,67 native groups,311 reference cases/40 files,
bidirectional completion types and lint/fmt/clippy. Uncached combined fixture closure
passes113 workspaces/16 builds/338 edges. HTTP passes25 Rust/48 native/443 reference
cases and types; fixture passes5 Rust/3 native/23 reference cases and types. Direct/
packed16MiB workers each exercise64 successful,64 rejected and64 canceled completion
requests with external runtime imports blocked. One initial pack raced the maintained
native rebuild and retained the earlier ready state; packing after completion fixes
the artifact and both workers pass. Evidence out/rust-client-initialization-*.
Zero runtime groups; no performance/memory superiority accepted.

JSON negotiation40d606513 is pushed; current publication unverified. Continuous
active06:26:57–06:31:25 adds268s, bringing conservative effort to89,968s (24.99h).
Minimum fulfilled; full rewrite/acceptance incomplete. Continue after06:31:25 UTC.

### Poe agent plugin setup and embedded MCP tools, 2026-09-21 06:44 UTC

Complete original plugin-api/setup and in-memory transport suites plus portable
reds precede Rust setup phases, bounded cursor tracking and opaque result templates.
The own agent addon embeds the Rust MCP client/OAuth bindings. Host preparation
embeds their own JS/declarations and auth-store lock; AST rewrites stdio type imports
to embedded own declarations. Official SDK references are isolated to explicit
development helpers. Cargo lock records only own path crates and the permitted
napi dependency tree. Maintained workspace declaration adds own client as a dev
build edge; npm lock update is scoped to that declaration. Preserve the concurrent
root safe-bash lock change independently. MCP/Unicode license notices accompany
the embedded implementation.

Rust sequences tool/prompt/hook declarations, callback setup, queued discovery and
cleanup registration. Node retains iterator/callback/property/coercion semantics.
Initial native live-registration red catches global mutable plugin capture in
prompt/disposal closures; per-plugin lexical capture repairs it and preserves
custom iterators, live additions/removals and original undefined rejection behavior.
Discovery preserves cursor getter reads while Rust tracks opaque identity handles
and continuation bounds. MCP result templates retain inherited/opaque payloads,
accessor causes, multimodal content, host interpolation order and terminal errors.
Setup/discovery failures settle before reverse disposal and retain aggregate causes.

Final maintained checks pass25 Rust cases,38 native groups,156 applicable complete
reference cases/10 files, including both full new plugin API files. Explicit runtime
import identity guards prevent original fallback. Bidirectional public PluginApi,
plugin entries/flush types and lint/fmt/clippy pass. Uncached own closure passes113
workspaces/36 builds/339 edges. Direct/packed16MiB cumulative workers retain all
earlier checks. Additional workers each run1024 setup callbacks,1024 disposal hooks,
1024 tool calls and16 real MCP subprocess cycles/32 multimodal/error calls with all
external runtime imports blocked. Recursive artifact audit covers76 JS/declaration
files, one addon, zero runtime groups; only the explicit SDK development adapter
may contain its two SDK dynamic imports. Evidence out/rust-poe-agent-plugin-setup-*.

Five alternating warmed1024 setup/disposal workloads measure TS2.92–4.97ms against
native13.72–14.89ms: speed gate FAIL. Isolated16MiB old-space repeated setup/disposal
exercises65,536 contexts with four forced collections/yields after each8192 batch.
Post-GC heap7.46→7.53MB; RSS93.5→98.0MB, with near-stable final batches. Finite
reclamation evidence does not establish universal leak/peak/TS memory superiority.
Worker RSS includes the parent and is not acceptance. Full execution/built-ins/
closure/platform/wider performance acceptance remain incomplete.

Client6c9214a8a push completed and remote main inclusion is verified. Root35568626036
has successful audit/build/checks/bash/cached-unit jobs; uncached unit remains active,
so no successful current publication is verified. Root35568021206 failed before
the embedding correction. Continuous active06:31:25–06:44:57 adds812s, bringing
conservative effort to90,780s (25.22h). Minimum fulfilled; full rewrite/acceptance
incomplete. Continue active work after06:44:57 UTC.

### Poe agent model stream assembly, 2026-09-21 07:03 UTC

Portable and native differential reds precede Rust-owned UTF16 text/thinking,
pending tool-use identity/arguments, ordered completion/error outcomes and final
usage/stop assembly. Opaque values stay in a Node GC arena; Rust output templates
preserve identity, undefined own fields and nonfinite numeric payloads. Node uses
standard async iteration and JSON.parse. Direct raw napi emitter invocation preserves
primitive thrown causes; the initial typed Function call failed on null/false/0.
Emitter getters execute at the original stage, retaining direct-text options
receiver versus partial-intent undefined receiver. A liveness red proves overwritten
usage/stop roots accumulated; retiring snapshots and successful parsed intent roots
with reusable arena slots repairs this. Incomplete null intents retain zero roots.

Maintained checks pass28 Rust cases,44 native groups,156 applicable complete original
reference cases/10 files, types and fmt/clippy. Seeded64 interleaved128-event streams
execute the current original private collector transpiled in memory. Uncached closure
passes113 workspaces/36 builds/339 edges. Direct/packed16MiB workers each run512
collections,65,536 replaced snapshots,512 incomplete intents and primitive-cause
checks with external runtime imports blocked. Cumulative plugin/MCP workers pass;
recursive artifact audit covers78 JS/declaration files,one addon,zero runtime groups.
Evidence out/rust-poe-agent-model-stream-*.

Five alternating warmed128-collection/32,768-event samples measure text TS2.61–3.11ms
versus Rust29.95–31.54ms; usage TS2.51–2.89ms versus Rust41.50–44.61ms. Both speed gates
FAIL. Isolated16MiB old-space workload runs16,384 collections,2,097,152 replaced usage
snapshots and524,288 incomplete intents. Four forced collections/yields per2048 batch
keep post-GC heap4.01→4.03MB; RSS57.2→72.1MB does not establish flat resident memory
or superiority. Full execution/closure/platform/performance acceptance incomplete.

Plugin setup60ba94ca3 push completed with remote inclusion verified. Root35569873132
remains pending;35568626036 is in_progress; no current successful root publication
verified. Continuous active06:44:57–07:03:11 adds1094s, bringing conservative effort
to91,874s (25.52h). Minimum fulfilled; full rewrite remains incomplete. Continue
after07:03:11 UTC.

### Poe agent ACP execution loop, 2026-09-21 07:12 UTC

Complete original runAcpCore describe is selected with an explicit own-import
identity guard; missing own module and portable execution/message-layout tests
fail first. Rust owns FIFO event/waiter queues, terminal admission, stop/disposal
state, iteration numbering and staged assistant/request message layouts. Node owns
promise/iterator/callback scheduling, serialization/spread/array-map/property effects,
AbortSignal listeners and model/host calls. This is hybrid execution, not a claim
that host callbacks, filesystem or networking have moved wholesale into Rust.

Loop supports lifecycle input handling, pre/post iteration and tool hooks, skips,
rewrites, guardrails, patched results, model tool iteration, multimodal/reasoning/raw
argument history, usage, token/iteration limits, stop hooks, disposal retries and
unique terminal events. Tool ACKs race abort even when the host ignores its signal.
Queue waiters settle in FIFO order, buffered events drain after close and return
runs the abort callback before closing. Native message copy callbacks use raw napi
invocation to retain primitive causes. Late name/tool-call assignment remains in
Node to preserve inherited setter effects. Model stop errors retain original Error
names/text, including changing stop getters and numeric limit coercion semantics.

Maintained checks pass33 Rust cases,50 native groups,183 complete reference cases/
10 files (27 new original execution cases),bidirectional model/options types and
lint/fmt/clippy. Seeded64 histories check compaction/system rules, key layouts,
multimodal/reasoning copies; custom getters/map failures preserve read order and
causes. One initial extra native comparison included per-run function identities
in terminal histories; comparing terminal outcome separately fixes that oracle.
Uncached closure passes113 workspaces/36 builds/339 edges. Direct/packed16MiB
workers each run576 runs,1024 model calls,512 rewritten multimodal tool ACKs,
512 cleanups and64 ignored-host cancellations with external imports blocked.
An initial artifact fixture used dispatch-shaped rewrite instead of the public
hook rewrite contract; correcting the fixture passes. Cumulative stream/plugin/
real-MCP workloads pass; recursive audit82 JS/declaration files,one addon,zero
runtime groups. Evidence out/rust-poe-agent-execution-*.

Five alternating warmed512-run samples: TS7.05–13.69ms versus Rust24.42–31.27ms;
speed gate FAIL. Isolated16MiB old-space workload runs16,384 complete two-model/
one-tool runs. Four forced collections/yields per2048 batch produce post-GC heap
6.45→6.68MB and RSS100.1→124.9MB. These finite measurements do not establish a
leak-free platform contract or memory superiority. AgentHost/builder/session/
built-ins/closure/platform/wider performance acceptance remain incomplete.

Model streamb2d03eddc push completed; remote inclusion verified. Current successful
root publication remains unverified. Continue active effort after the prior07:03:11
checkpoint; minimum24h fulfilled, overall rewrite remains incomplete.

### Poe agent host tools, forks and injected ACP spawn, 2026-09-21 07:18 UTC

Full original AgentHost.handle/fork/spawn describes plus portable host-state reds
precede own host. Rust owns invocation close admission, fork numbering, yielded
ACP event layouts and UTF16 spawned output. Node owns client/callback/generator
execution, notification hooks, linked child cancellation and disposal. Forks copy
own registries into isolated contexts, track children and retain single lifecycle
events. Tool abort attempts generator.return once even if it rejects. Spawn collects
text chunks from an injected client independently of parent abort and always disposes.
No production integration or npm runtime edge. Own process/in-memory factory/default
agent-session adapters remain pending; the complete original spawn describe uses its
in-memory client as an explicit development fixture while an import identity guard
proves own AgentHost executes. Native artifact workers inject standalone own test
clients and do not depend on the fixture.

An additional differential red catches eager emitter short circuit skipping the
original unconditional yielded-type getter when no emitter exists. Rust now separates
classification from payload mapping; payload getters still execute only on emission.
Spawn chunk coercion uses Node default-hint concatenation via raw napi invocation,
retaining Unicode/lone surrogates, changing getters and primitive failure causes.
Complete native comparisons cover stream/coercion/disposal failures and callback
read order. Maintained checks pass35 Rust cases,54 native groups,197 complete original
reference cases/10 files (14 newly selected host cases),bidirectional client/host
types and fmt/clippy. Uncached closure113 workspaces/36 builds/339 edges passes.
One test/build overlap temporarily removed original reference dist; a concurrent
schema build produced another missing-entry race. After maintained schema closure
and settled builds, complete maintained unit route passes; no case counted as pass
while its fixture was unavailable. Keep builds and artifact-dependent tests sequential.

Direct/packed16MiB workers each execute512 streamed tools/notifications,64 isolated
forks and128 parent-aborted injected-client spawns/cleanups with external imports
blocked. Cumulative execution,model-stream,plugin/MCP workers pass; recursive audit84
JS/declaration files,one addon,zero runtime groups. Evidence out/rust-poe-agent-host-*.
Five alternating warmed4096-streamed-tool/8192-yield samples measure TS3.33–6.07ms
versus Rust11.28–14.20ms; speed gate FAIL. Isolated16MiB old-space workload creates/
disposes32,768 contexts and tools with four collections/yields per4096 batch.
Post-GC heap7.61→6.44MB and RSS89.3→97.9MB provide finite reclamation evidence only.
No universal stability/memory/speed superiority accepted.

Executione88ab9554 is pushed; exact remote main delivery verified. Root35568626036
uncached unit step remains in_progress; latest release queues remain pending, so no
current successful publication verified. Continuous active07:03:11–07:18:08 adds897s,
bringing conservative effort to92,771s (25.77h). Minimum fulfilled; overall rewrite/
closure/platform/acceptance incomplete. Continue after07:18:08 UTC.

### Poe agent built-in MCP/policy/skills/scratchpad/spawn/limits, 2026-09-21 07:26 UTC

Portable builtin state/validation reds and four additional reference suites fail
before own artifact availability. Added own mcpPlugin,policyPlugin,maxIterationsPlugin,
scratchpadPlugin,skillsPlugin,spawnPlugin plus shared plugin argument/option helpers.
Rust owns overwritten UTF16 scratchpad notes, normalized skill definitions and
membership, guidance formatting, scalar finite/integer/ECMAScript-blank validation,
iteration comparison and policy diagnostics/permissive-mode classification. Node
retains property reads, Object.entries/custom iterator/trim effects, callback receivers,
metadata spreads, path/fs operations and optional policy/spawn callbacks. MCP wrapping
uses own native-backed configuration clone and own discovery. No production integration.
Shared own-code ENOENT detection uses own descriptors, never inherited error codes.
Remaining option-object/array traversal runs in Node to retain its observable effects.

Maintained checks pass38 Rust cases,59 native groups,227 complete reference cases/
14 files,typed builtin assignment and fmt/clippy. Explicit built-in/argument/policy
import guards prove original fallback cannot pass. Full policy suite borrows original
file/shell metadata/validators as development fixtures; own production imports remain
relative/built-in only. Seeded64 skills configurations,UTF16 note replacement,late
getter/stringification order,primitive callback/format failures,scalar numeric/string
boundaries and optional value identity cross-check against originals. Uncached closure
113 workspaces/36 builds/339 edges passes. Direct/packed16MiB workers each exercise
4096 note writes,1024 skill prompts,512 denied policy contexts/cleanups and128 injected
spawn calls with external imports blocked. Cumulative host/plugin/real-MCP workloads
pass; recursive artifact audit103 JS/declaration files,one addon,zero runtime groups.
One initial artifact worker had an unmatched option-object brace; corrected fixture
passes before any acceptance. Evidence out/rust-poe-agent-builtins-*.

Five alternating warmed16,384 skill-prompt samples measure TS8.44–14.57ms versus
Rust37.17–41.71ms; speed gate FAIL. Isolated16MiB old-space workload creates65,536
scratchpad/skills plugins and1,048,576 same-key note replacements. Four forced
collections/yields per4096 pair batch keep post-GC heap7.47→7.51MB,RSS85.1→88.4MB.
Finite reclamation evidence only; no universal memory/speed/stability superiority.
Other built-ins,registry,builder,session adapters,full closure and platform/performance
acceptance remain incomplete.

Hostaf2d00d03 push completed; exact remote main delivery verified. Root35568626036
uncached unit remains in_progress and no current successful release verified.
Continuous active07:18:08–07:25:45 adds457s, bringing conservative effort to93,228s
(25.90h). Minimum fulfilled; full rewrite remains incomplete. Continue after07:25:45.

### Poe agent memory/compaction/audit/system/environment context, 2026-09-21 07:34 UTC

Portable context primitive tests and missing-artifact reference reds precede own
memoryPlugin,compactionPlugin,auditLogPlugin,systemPromptPlugin,environmentPlugin and
bundled prompt loaders. The source system prompt is copied additively and maintained
host preparation ships it. Rust scans UTF16 memory lines/imports without regexes,
owns active import paths and rejects cycles. Node performs nearest-file walking,
trusted canonical-path/symlink checks, filesystem operations and cached promises.
All original recursive memory behavior,handle-text preservation,escaped import
rejection,nearest-file selection and own-code ENOENT handling remain exercised.

Rust compaction scans user turns backwards, defers numeric limit coercion until a
user is found, then lazily classifies only the old prefix. It preserves ordinary
systems/recent entries, drops old summaries and retains original entry identity.
Zero/fractional/NaN/infinite limits match original semantics. Node runs pre/post
hooks,summarizer arity/callbacks and observable message/summary mutation. Rust formats
summaries and sorts/renders UTF16 file awareness. Audit templates preserve timestamp/
field order and opaque serializer payloads while Node owns dates,JSON.stringify and
append error policy. System/environment prompt spreads/resource IO remain in Node.
Initial napi3 legacy string conversion included a terminator/lossy String path;
using owned Utf16String conversion preserves lone surrogates and exact bytes.

Maintained checks pass40 Rust cases,64 native groups,251 complete original reference
cases/16 files,typed context-plugin assignments and fmt/clippy. Explicit import
guards prove every selected context plugin executes the own artifact. Seeded64
mixed-role histories compare full compaction decisions/callback requests,including
post-hook summary changes; native access-order cases prove tail names/unused limit
coercion are not evaluated. Memfs recursive/cycle/cached-failure comparisons and
all26 ECMAScript whitespace scanner cases pass. Uncached closure113 workspaces/
36 builds/339 edges passes. Direct/packed16MiB workers each run256 cached memory
loads/768 reads,512 audit records,256 compactions and bundled-resource equality,
with external imports blocked. Cumulative builtin/host/plugin/real-MCP workers pass;
recursive audit115 JS/declaration files,one addon,zero runtime groups. Evidence
out/rust-poe-agent-context-*.

Five alternating warmed512-compaction/65,536-message samples measure TS4.61–5.65ms
versus Rust29.15–32.22ms: speed gate FAIL. Isolated16MiB old-space workload creates
16,384 memory plugins and compacts16,384 histories with four collections/yields per
2048 batch; post-GC heap7.63→7.76MB,RSS75.2→75.9MB. Finite reclamation only; no
universal memory/speed/stability advantage or complete closure accepted.

Builtinsbd4d62ca9 push completed; exact remote main verified. Root35568626036 is now
failed: safe-js adversarial corpus aggregate CPU775.7ms exceeded its750ms budget;
31,122 other safe-js cases pass and preceding Rust native workspaces pass. Inspect
current harness/test and validate a focused repair independently; no release success
claimed. Overall agent builder/session/remaining providers/files/shell/web/registry/
closure/platform/performance acceptance incomplete. Continuous active07:25:45–07:34:30
adds525s, bringing conservative effort to93,753s (26.04h). Minimum fulfilled;
continue after07:34:30 UTC.

### Poe agent file tools and owned glob matcher, 2026-09-21 08:01 UTC

Resumed after checkpoint at07:37:09 UTC; excluded the07:34:30–07:37:09 gap.
Context5598f45b6 push completed and exact remote-main inclusion verified. Validated
root35568626036 CPU775.7ms failure against current safe-js harness. Profiling showed
repeated sandbox initialization dominated the corpus, while regex exhaustion used
only~2ms. Atomic21c6f6741 combines mapped/race/any deterministic assertions into one
sandbox execution, still repeats the complete result twice, preserves every other
attack and retains750ms CPU/2000ms wall limits. Maintained adversarial route passes141
cases (one declared slow case skipped), focused ESLint/diff checks pass. Commit pushed
and exact remote main verified; root35573960603 remains pending. Earlier35569873132,
35571163016 and35573682657 are cancelled. No current successful release verified.

Missing portable-module/native-artifact reference reds precede own filesPlugin and
Rust UTF16 file core. Implements read_file/edit_file/list_files/grep/glob with original
schemas/policy, allowed-path checks, image results, line offsets/limits, atomic edits,
create collisions and cleanup/retry effects. Rust owns exact line windows, MIME
classification, nonoverlapping KMP search/counting and replacement templates. Single
replacement preserves JS $$/$&/prefix/suffix expansion; replace_all stays literal.
Node retains argument getter timing, filesystem/callback effects, locale/mtime sort,
AbortSignal and process launch. Grep still requires rg or injected searchContent;
zero npm runtime dependencies does not mean zero executable/OS requirements.

Owned Rust glob parsing/matching replaces fast-glob runtime import. Supports hidden
files, static prefixes, globstars, classes/literal brackets/POSIX classes, nested
braces/padded numeric and alpha ranges, extended/bare groups and negated-group suffix
semantics. Node traverses only the prefix/depth admitted by Rust and sends all file
candidates per directory in one native batch. Static lookups and filtering preserve
original behavior; malformed group patterns select no files. Ancestry tracking
bounds symlink cycles while retaining separate noncyclic aliases. Pattern16384-unit,
nesting64 and range10000-alternative limits are deliberate bounded-input deviations.
Matcher uses owned sets/memoized sequence endpoints, not an external regex/glob crate.

Maintained checks pass45 Rust cases,70 native groups,264 complete applicable original
cases/17 files,bidirectional file-plugin declarations and fmt/clippy. Memfs fixtures
cross-check full official fast-glob output (including its posix/brace settings), seeded
128 line reads,512 exact edits,bulk128-path flags,side-effect order and cycle termination.
Initial eager reference import broke process mocks; AST rewriting each original
lazy import to the own artifact preserves mock timing and prevents reference fallback.
Focused syntax/format/diff checks pass. Uncached maintained closure113 workspaces/
36 builds/339 edges passes. Direct/packed16MiB old-space workers each run512 reads,
512 atomic edits,512 globs,512 injected grep calls,image/create-collision and escaped
path checks with external imports blocked. Cumulative context/builtin/host/real-MCP
workers pass; recursive packed audit119 JS/declaration files,one addon,zero runtime
package groups/imports (explicit SDK development adapter exception only). Evidence
out/rust-poe-agent-files-*.

Initial wall samples overlapped other CPU checks; reran after own checks settled and
recorded thread CPU as well as wall time. Five alternating warmed512 line-read samples
on252842-unit content measure TS CPU2.15–3.49ms versus Rust8.52–9.66ms:FAIL.32 glob
traversals/256 files measure TS CPU7.97–17.01ms versus Rust9.39–12.84ms:mixed/FAIL.
No uniform performance advantage accepted. Isolated16MiB old-space workload builds/
reclaims32768 glob contexts,1048576 path flags and32768 edits;four GC/yield rounds per
2048 contexts keep post-GC heap4.87→4.91MB,RSS59.5→68.5MB. Finite reclamation evidence
only; full leak freedom,stability and memory superiority remain unproven.

Continuous active07:37:09–08:01:02 adds1433s, bringing conservative effort to95186s
(26.44h). Minimum fulfilled; overall builder/session/remaining plugins/toolcraft/
spawn closure/platform/Python/performance acceptance incomplete. Continue after
08:01:02 UTC.

### MCP client exchange parity and typed SSE, 2026-09-21 08:14 UTC

Resumed from checkpoint at08:11:38 UTC; conservatively exclude the preceding
checkpoint interval from effort accounting. Original client changes introduce15
validated reference failures in the own rewrite. Rust request-policy tests first
fail for the missing module; maintained original references provide deadline/pin
reds. Own Rust now rejects overflowing/nonfinite/negative timer values and unknown
protocol pins. Node retains one timer across input callbacks and continuation
requests, aborts callback signals, cancels the latest wire ID, and catches timeout
observer failures. Explicit modern discovery errors never downgrade to legacy.
Atomic7b8346623 is pushed and exact remote-main delivery verified.

Typed SSE emits arbitrary named events only with explicit with_all_events mode
(third native constructor argument). MCP default/endpoint modes remain intact.
Overflow clears partial frames while retaining cursor/configuration; repeated
recovery/every-split named-event native and Rust cases pass after recorded reds.
Atomice303ecfaa is pushed and exact remote-main delivery verified.

Maintained client checks pass37 Rust cases,69 native groups,328 complete applicable
reference cases/42 files,TypeScript contracts,fmt/clippy and focused JS ESLint.
Uncached maintained closure113 workspaces/15 builds/339 edges passes. Existing JS
wrappers do not pass standalone Prettier checking; no format-pass claim. Evidence
out/rust-client-typed-sse-*,out/rust-client-request-policy-red.log and
out/rust-client-deadlines-*. Root35575807333 remains pending; no successful current
publication verified. No provider implementation delivered yet, no complete closure
or performance/memory/stability superiority accepted.

Active08:11:38–08:14:43 adds185s, bringing conservative effort to95371s (26.49h).
Minimum fulfilled; continue the remaining agent/runtime/provider/spawn/toolcraft/
platform/Python acceptance after08:14:43 UTC.

### Owned OpenAI streaming transport, 2026-09-21 08:20 UTC

Additive internal transport implements the Chat Completions create and Responses
stream operations required by the pending provider plugins; it is not a full SDK
replacement and no provider plugin is exported yet. Node owns fetch/TLS, headers,
JSON effects, reader cancellation, caller signals and timers. Rust owns explicit
all-event SSE framing and retry status/override policy plus capped jitter backoff.
SDK is an explicit dev dependency only. Error bodies are bounded1MiB and SSE events
16MiB; timer/server-delay overflow rejects instead of silently clamping to1ms.
Cancellation before iteration, pending reads and early break release bodies/readers
and caller listeners. Dedicated unconsumed-stream red caught a leaked response
body; fixed before delivery. Missing-module/native-policy reds are recorded.

Checks pass47 Rust cases,79 native groups,264 applicable complete original
reference cases/17 files,bidirectional existing types,fmt/clippy,focused ESLint and
diff checks. Uncached maintained closure113 workspaces/36 builds/339 edges passes.
Nine new native groups cross-check all byte splits of mixed CRLF/Unicode chat SSE,
named/multiline Responses SSE,application request headers and observable SDK API
error fields; bounded attempts/canceled retry responses and lifecycle checks pass.
Direct/packed16MiB old-space workers each stream32768 events across1024 requests
and cancel512 early exits with external imports blocked. Recursive packed audit
120 JS/declaration files,one addon,zero runtime groups/imports (existing explicit
SDK development adapter exception). Evidence out/rust-poe-agent-openai-*.

Five warmed alternating512-request/16384-frame mocked samples measure SDK CPU
38.89–51.82ms versus own17.43–23.05ms: this scoped speed gate PASS. It combines
removed SDK overhead and own framing; no isolated Rust contribution/end-to-end
network or universal advantage claimed. Finite8192-request16MiB old-space repeated
GC workload records reclamation only; no complete leak freedom/memory superiority.

Documentationb75fe6a0c push and exact remote-main verified. Release35576917226
remains pending; no current publication success verified. Continuous active
08:14:43–08:20:59 adds376s,bringing conservative effort to95747s (26.60h). Minimum
fulfilled; provider plugins/agent builder/session/spawn/toolcraft/Python/platform
and wider performance acceptance remain incomplete. Continue after08:20:59 UTC.

### Poe agent Chat Completions provider, 2026-09-21 08:33 UTC

Additive exported openaiChatCompletionsPlugin preserves original options/header
merge,base URL/environment precedence,explicit/Poe-env/own-store/SDK-env credential
resolution,verbatim tool names,images/tool messages/reasoning fields,schema normalization,
streamed text/tool arguments,exact host JSON.parse error strings,usage/cache counters
and stops. Rust owns ordered tool identities/index correlation,exact UTF16 argument
assembly,usage normalization and stop mapping; host retains request objects,signals
and parse diagnostics. Native input projects used fields instead of enumerating
metadata; an unused-getter/nonfinite-usage red preceded this repair. Tool state has
8388608 retained-unit and4096 tool/index bounds. Frames from one network read use one
native batch call; valid prefixes still deliver before later API/JSON failures.
Original constructor/auth mocks are AST-rewritten to own transport/store modules,
with explicit own-import guards; no reference production fallback.

Checks pass49 Rust cases,83 native groups,280 complete applicable original reference
cases/19 files,bidirectional provider declarations,fmt/clippy,focused ESLint and
diff checks. Seeded128 end-to-end own/original provider fixtures compare complete
event lists and application request bodies,including interleaved IDs,invalid args,
nonstandard finish reasons,reasoning/images/cache counters. Adversarial index/retained
data bounds pass. Initial own build/test overlap removed tiny-client reference dist
and caused two native file imports to fail; settled maintained rerun passes fully.
Uncached maintained closure113 workspaces/36 builds/339 edges passes. Direct/packed
16MiB old-space workers each complete1024 calls/6144 provider events with external
imports blocked and no remaining caller abort listeners. Packed audit125 JS/declaration
files,one addon,zero runtime groups/imports (existing explicit SDK dev adapter exception).
Evidence out/rust-poe-agent-openai-chat-*,out/rust-poe-agent-chat-*.

Full provider pre-batch CPU47.24–60.13ms TS versus52.97–63.97ms own;mixed/FAIL.
Settled five alternating warmed512-call/16384-frame batched samples measure TS
43.70–57.44ms versus own48.44–51.92ms:FAIL. Batch reduces overhead but not enough
for uniform speed advantage. Transport-only scoped speed PASS remains distinct.
Finite transport8192-call GC heap6.93→7.30MB,RSS66.6→76.9MB does not establish full
provider leak freedom/memory superiority. No complete engine/runtime accepted.

Transportd14f07d97 exact remote-main delivery verified; root35577498449 pending
(build/audit jobs pending). No current successful publication verified. Concurrent
e296d0d90 adds legacy MCP revisions in originals; validate and port next. Continuous
active08:20:59–08:33:29 adds750s,bringing conservative effort to96497s (26.80h).
Minimum fulfilled; remaining Responses/other plugins/builder/session/spawn/toolcraft/
Python/platform/performance acceptance incomplete. Continue after08:33:29 UTC.

### MCP client legacy revisions, 2026-09-21 08:41 UTC

Current original e296d0d90 introduces9 validated own reference failures. Own Rust
now admits supported legacy2025-03-26/2025-06-18/2025-11-25 revisions and rejects
a different selected revision under an explicit pin. Exports frozen
MCP_PROTOCOL_VERSIONS and McpProtocolVersion declarations. Legacy pins skip modern
discovery; automatic negotiation retains fallback. Rust transport records requested
and negotiated revisions,correlates raw initialization IDs (including batch arrays),
and supplies subsequent POST/GET/DELETE version headers. Host delays GET until the
initialization reply and awaits/closes an open initialization POST SSE stream before
continuation. Raw initialization batches remain accepted,validated against the
original transport after a dedicated red. Once initialization completes, ordinary
emission skips native initialization parsing/crossings.

Maintained client checks pass39 Rust cases,70 native groups,338 complete applicable
original reference cases/43 files,types,fmt/clippy,focused ESLint and diff checks.
Uncached maintained agent closure113 workspaces/36 builds/339 edges rebuilds the
embedded client and passes; maintained agent route49 Rust cases,83 native groups,
280 references/19 files and types passes. Direct/packed16MiB old-space client workers
each negotiate384 sessions across three legacy revisions/automatic and explicit pins,
check all HTTP-channel headers and cancel192 open initialization POSTs. Cumulative
initialization workers each retain64 successful/64 rejected/64 canceled-ignoring-fetch
cases. Archive has one addon/zero runtime dependency groups. Evidence
out/rust-client-legacy-*. No uniform performance/memory/stability superiority claimed.

Chat496ae8a8b push/exact remote-main verified. Its release35578583076 remains pending;
no current publication success verified. Continuous active08:33:29–08:41:03 adds454s,
bringing conservative effort to96951s (26.93h). Minimum fulfilled; remaining
Responses/shell/web/registry/builder/session/spawn/toolcraft/Python/platform/performance
acceptance incomplete. Continue after08:41:03 UTC.

### Responses provider, 2026-09-21 08:53 UTC

Additive `openaiResponsesPlugin` uses the owned fetch transport and Rust tool
alias/UTF16 assembly, model support, usage and terminal-state policy. Host keeps
request serialization, exact JSON.parse diagnostics and original opaque reasoning
payloads. Reasoning effort/summary/project/include options preserve reference
request behavior. Default include requests encrypted reasoning. Native batches stop
at terminal events and defer tool-parse success/stop resolution correctly within
one batch. Responses requests start immediately; deferred iteration observes errors
without an unhandled rejection. Original provider suites execute own artifact mocks
with explicit import guards; SDK runtime remains development-only.

Reference and Rust reds preceded implementation (out/rust-poe-agent-responses-*).
Maintained checks pass51 Rust cases,87 native groups,292 complete applicable original
reference cases/20files,bidirectional declarations,fmt/clippy,focused ESLint and
diff check. Uncached maintained selected closure113workspaces/36builds/339edges passes.
64 seeded valid official-SDK HTTP streams compare event lists and request bodies,
including message/tool/reasoning creation, usage and all three terminal states.
Archive audit127 JS/declaration files,one addon,zero runtime groups/imports (explicit
SDK development adapter exception retained). Direct/packed16MiB old-space workers
each finish1024 calls/8192events plus128 early returns/128 pending-read cancellations;
caller abort listeners release. Finite workload evidence does not prove leak freedom.

Five alternating warmed512-call/16384-text-frame samples: original SDK provider CPU
108.03–159.80ms versus own49.24–57.00ms, scoped speed PASS. This includes bypassing
SDK Responses snapshot bookkeeping; full malformed event-order validation is not
reproduced. Null terminal usage/exception parity and broad memory/stability/platform
acceptance remain unverified. Chat speed FAIL remains separate; no universal Rust
superiority or complete agent runtime claimed. Evidence out/rust-poe-agent-responses-*.

Legacy d2e425771 exact remote-main verified. Release35579223367 audit success/build
in_progress; no current successful publication verified. Conservative active effort
adds429s through last pre-checkpoint clock08:48:12, excludes checkpoint gap, then
adds105s from08:51:58–08:53:43:total97485s (27.08h). Minimum fulfilled; remaining
shell/web/registry/builder/session/spawn/toolcraft/Python/platform/performance work
incomplete. Continue after08:53:43 UTC.

### Shell plugin, 2026-09-21 09:06 UTC

Additive `shellPlugin` supplies run_command/read_background/kill_background with
foreground/background execution, cancellation, bounded capture, notifications,
timeouts, kill escalation and disposal. Rust owns UTF16 quote/operator/variable
scanning, reference read/edit policy, timeout bounds and131072-unit output rings.
Node preserves subprocess/process-group effects, filesystem/symlink checks, callback
errors and original result diagnostics. No shell-quote runtime dependency. Policy
input exceeds1048576 UTF16 units rejects with a policy diagnostic. This is not a
shell sandbox; arbitrary shell syntax/prototype-backed environment substitution and
all-platform behavior are not exhaustively accepted.

Own Rust unresolved-module red preceded implementation. Reference reds found an
elided host import; native cross-product reds found curl --data-raw= handling,
unterminated substitution token boundaries and escaped wildcard policy. Repairs
precede settled maintained checks53 Rust cases,90 native groups,314 complete original
reference cases/21files,bidirectional types,fmt/clippy,focused ESLint and diff checks.
Uncached maintained selected closure113workspaces/36builds/339edges passes. Real
subprocess reference cases cover output, background read/kill/dispose, timeout,
cancellation and unresolved/rejected notifications. Native fixtures compare quote,
wrapper, environment-assignment, operator, glob, malformed-substitution and exact
surrogate output behavior.

Packed audit129 JS/declaration files,one addon,zero runtime groups/imports (explicit
SDK development adapter exception retained). Direct/packed16MiB old-space workers
each complete2048 injected foreground calls/4096policy checks/2048bounded-buffer
cycles. Initial retention metric test failed: process.memoryUsage.external exposes
only40 additional bytes for16 buffers, but does not represent manual NAPI allocation
accounting in this runtime. Binding now reports actual ring capacities through
napi_adjust_external_memory, balances retirement using custom_finalize and exposes
the returned V8 counter through the internal append operation. Maintained tests use
that counter rather than falsely treating the Node metric as proof. Four64-buffer
16MiB GC cycles register allocations, avoid growth under replacements and retire
accounting after collection (one last loop-slot buffer stays live). Finite evidence
is not universal memory superiority or leak freedom; wider native-accounting audit
is still outstanding. Heap/RSS observations remain separate. Evidence
out/rust-poe-agent-shell-*.

Five alternating warmed16384-check samples: original CPU21.96–24.84ms versus own
12.02–13.34ms, scoped policy speed PASS. Does not establish subprocess speed or
complete runtime superiority. Responses3133d9ac1 exact remote-main delivery verified;
release35580327258 pending. Legacy35579223367 build/audit/checks/bash pass, unit still
in_progress; no successful current publication verified. Concurrent safe-bash
commits preserved. Continuous active08:53:43–09:06:32 adds769s,total98254s (27.29h).
Minimum fulfilled; remaining web/registry/builder/session/spawn/toolcraft/Python/
platform/performance acceptance incomplete. Continue after09:06:32 UTC.

### Web plugin, 2026-09-21 09:18 UTC

Additive `webPlugin` supplies search_web/fetch_url. Rust owns literal-host policy,
content-type normalization, UTF16 pagination, five-result formatting and owned HTML
Markdown conversion. Node retains URL parsing, fetch, bounded body decoding,
DuckDuckGo property/iteration effects and callbacks. HTML parser/scanner uses no
external Rust/npm runtime dependencies; complete HTML5 tree repair is not implemented.
HTML supports blocks/headings/quotes/lists/links/images/emphasis/code, escaping,
whitespace collapse and named/numeric references.2231 named references derive from
Python3.14 stdlib html.entities; its license ships in the packed archive. Input
200000 UTF16 units, nesting128 levels and per-node rendered output8388608 units
bounds reject excess. Aggregate parser allocations/malformed-input parity remain
outside complete acceptance; no universal memory claim.

Own web/HTML unresolved-module reds precede core implementation; native missing
bindings red precedes linkage. Own pending body-read fixture reproduces abort that
never settles; host now checks abort around reads, cancels pending reader and releases
lock/listener on success/failure. Maintained checks55 Rust cases,94 native groups,
333 complete applicable original reference cases/22files,bidirectional declarations,
fmt/clippy,focused ESLint and diff checks pass.48 structural HTML page fixtures plus
entity/host/exact-surrogate pagination comparisons match actual original Turndown
provider over mocked HTTP. Uncached maintained selected closure113workspaces/
36builds/339edges passes. Packed audit131 JS/declaration files,one addon,zero runtime
groups/imports (explicit SDK development adapter exception retained). Direct/packed
16MiB old-space workers each finish1024 HTML fetches/128 pending-read cancellations,
with no retained reader locks/caller abort listeners. Finite evidence only.

Five alternating warmed256-fetch/32-paragraph samples have original CPU124.45–140.07ms
versus own27.60–31.72ms, scoped speed PASS, identical returned-unit totals. Does not
accept arbitrary HTML or full-runtime superiority. Evidence out/rust-poe-agent-web-*.

Shell879c3a9ad exact remote-main delivery verified; release35581488911 pending.
Responses35580327258 canceled. Legacy35579223367 failed five current original
client-isolation contracts in mcp-oauth-rust and skipped publication. Local current
named-reference reproduction gives5 failed/7 passed: dynamic explicitly configured
client identity must check cached/expired/pending grants before refresh/recovery.
Repair is next, preserving original TS source and foreign changes. No successful
current publication verified. Continuous09:06:32–09:18:29 adds717s,total98971s (27.49h).
Minimum fulfilled; remaining OAuth repair/registry/builder/session/spawn/toolcraft/
Python/platform/performance acceptance incomplete. Continue after09:18:29 UTC.

### Dynamic OAuth client isolation repair, 2026-09-21 09:22 UTC

Release35579223367 reproduces5 current original client-isolation failures locally
(named reference5failed/7passed); a new Rust cached/pending fixture also fails before
repair. Rust binding_action now compares normalized configured IDs/secrets for both
static and explicitly configured dynamic apps before cached reuse/expired refresh/
pending recovery. Host projects refreshState into that gate. Dynamic native-owned
registration with no explicit client remains reusable. Mismatch diagnostic includes
no credentials and rejects before headers/fetch/browser/persistence effects.

Maintained OAuth checks57 Rust cases,91 native groups,470 full original references/
35files,types,fmt/clippy,focused ESLint/diff pass. Uncached maintained agent closure
113workspaces/36builds/339edges rebuilds all affected embedded addons and passes;
agent55 Rust/94 native/333 reference cases/22files/types pass. Direct/packed/agent-
embedded16MiB old-space workers each reject1536 mismatched cached/expired/pending
grants and reuse256 matching/native-owned grants,zero effects or exposed credentials.
Finite evidence does not accept all memory/platform/performance behavior. Evidence
out/rust-oauth-dynamic-*,out/rust-oauth-current-isolation-red.log,
out/rust-release-35579223367-failed.log. No changes to original TS source.

Web9f37539bd exact remote-main verified; release35582585964 pending. Current publication
remains unverified; failed/canceled older runs remain separate from delivery.
Continuous09:18:29–09:22:58 adds269s,total99240s (27.57h). Minimum fulfilled; registry/
builder/session/spawn/toolcraft/platform/performance acceptance and later Python
bindings remain incomplete. Continue after09:22:58 UTC.

### Plugin registry and configuration, 2026-09-21 09:32 UTC

Additive frozen builtin specs and public config parser/resolver exports preserve
the original ordered mutable registry and callback/property behavior. Rust owns
configured-name identity and UTF16 suggestion distance with one-row O(min(length))
working memory. Maintained checks56 Rust cases,96 native groups,346 original
reference cases/24files,bidirectional declarations,fmt/clippy,focused ESLint and
diff checks pass.17424 independent seeded distance comparisons pass; uncached
maintained agent closure113workspaces/36builds/339edges passes.

Packed audit135 JS/declaration files,one addon,zero runtime groups/imports with
explicit SDK development adapter exception. Direct/packed16MiB old-space workers
each finish1024 resolutions/9216plugins/1024unknowns/1024duplicates and dispose
created plugins. Initial worker fixture omitted mandatory policy mode; corrected
fixture uses edit without implementation change. Evidence out/rust-poe-agent-
plugin-config-*. Five alternating512resolution samples: known three plugins
original CPU1.127–1.767ms versus own1.674–2.600ms, scoped performance FAIL; unknown
1024-unit name original404.196–438.947ms versus own40.806–43.598ms, PASS. No universal
performance or memory acceptance claim.

OAuth08bd41f50 exact remote-main delivery verified; release35583012163 remains
pending,publication unverified. Prior continuous09:22:58–09:28:46 adds348s; checkpoint
gap excluded. New active09:30:35–09:32:00 adds85s conservatively,total99673s (27.69h).
Minimum fulfilled; builder/session/spawn/toolcraft/platform/performance acceptance
and later Python bindings remain incomplete. Continue accounting after09:32:00 UTC.

### Public builder, sessions and child factories, 2026-09-21 09:41 UTC

Additive agent/model/use/tools/mcp/run/stream/acp exports now use the owned config,
provider/plugins, execution, hooks, tools and transcript foundations. Reusable
createAgentSession supports default owned plugins, injected providers, history,
JSONL persistence, tree snapshots, navigation and forks. Owned ACP client and
user-error core embed in the same addon. Explicit owned development dependencies
record their maintained build closure; root lock update contains only those two
references, retaining concurrent original-package changes. Node retains async
callbacks, arbitrary results/property effects, provider creation and I/O; this
does not assert a fully native execution path.

Rust caller ACK state has exact UTF16 identities/insertion order, duplicate/unknown
retirement and index reuse once empty.4096pending intents/1048576aggregate identity
units bounds reject without losing existing requests. Rust in-memory transport
state closes once and rejects session IDs after disposal. New reds reproduce
late creation retention, unhandled disposal/notification failures and completion
notifications after disposal. Host waits for pending creations, retires late
sessions, awaits notification callbacks, rejects disposed requests/prompts and
reports cleanup errors through closed. These guards intentionally exceed original
adapter lifecycle behavior; original source is unchanged. Initial own ACK fixture
used invoke instead of Tool.call; fixture corrected without implementation change.

Maintained60 Rust cases,105 native groups,434 original reference cases/27files,
bidirectional builder/session/factory declarations,fmt/clippy,focused changed-host
ESLint and diff checks pass.96 seeded complete own/original builder scenarios
compare tools, failures, usage, resume, stdout and disposal. Uncached maintained
closure113workspaces/37builds/341edges passes. A broad extra ESLint invocation found
require-yield on two intentional terminal-only generators in existing owned tools;
focused new/changed adapters pass; documenting those semantics is a separate next
atomic change.

Packed audit159 JS/declaration files,one addon,zero runtime groups/imports with
SDK development adapter exception. Direct/packed16MiB old-space workers each finish
1024 tool runs/128forkable sessions/128caller ACKs/128abort retirements/512child
sessions,balanced child disposals and no retained caller abort listeners. This
finite coverage is not a comprehensive allocation/platform/leak acceptance.
Five warmed alternating512 complete injected-model tool-run samples give original
CPU16.692–36.261ms versus own47.972–66.307ms, scoped speed FAIL with identical output
units. Native runtime crossing overhead remains an outstanding performance issue;
do not claim general superiority. Evidence out/rust-poe-agent-builder-*.

Registry249c8207e exact remote-main delivery verified; release35583768081 in_progress.
Publication remains unverified. Concurrent safe-bash/OAuth commits preserved.
Continuous09:32:00–09:41:36 adds576s,total100249s (27.85h). Minimum fulfilled; wider
agent-spawn/toolcraft/platform/performance acceptance and later Python remain
incomplete. Continue accounting after09:41:36 UTC.

### Agent exports and reusable subprocess binding, 2026-09-21 09:49 UTC

Delivered8bbf3b56b comments explain intentional terminal-only tool generators;
whole owned-agent host ESLint now passes without changing runtime behavior.
Delivered2552d9438 extracts agent-spawn command bindings into a reusable module,
retaining the same exported native command/timing operations and shared number
semantics. Agent-spawn maintained Rust/native/reference310cases/11files,types and
fmt/clippy pass; exact remote-main2552d94386440ad64ed8a21c18ca09b74b596352 verified.

Additive gitContextPlugin reuses that binding and host subprocess adapter in the
same agent addon. Native core joins host-coerced prompt sections preservingUTF16,
with8388608output units bound. Status/log calls execute together, failed calls
contribute empty strings, and spread/coercion effects remain in Node. New missing
core/export reds precede implementation. Maintained61 Rust cases,106native groups,
441original references/28files,complete bidirectional original public function
exports,fmt/clippy,whole owned-host ESLint and diff checks pass. Uncached maintained
closure113workspaces/37builds/341edges passes. Packed audit163JS/declaration files,
one addon,zero runtime groups/imports with explicit SDK development exception.
Direct/packed16MiB old-space workers each complete32actual Git prompts/64commands
and16384format checks without external package imports. Finite artifact evidence;
no Git subprocess speed or full memory/platform acceptance claim. Evidence
out/rust-poe-agent-git-context-*,out/rust-agent-spawn-command-reuse-*.

Builder7d0c77475 exact remote-main verified,release35584755704 canceled. Registry
35583768081 in_progress; reusable-command release35585030348 pending. Publication
remains unverified; concurrent original OAuth/safe-bash work preserved. Missing
providers/task-list/poe-code-config/agent-harness-tools Rust counterparts and wider
spawn/runtime/performance acceptance remain; Python remains architectural follow-up.
Continuous09:41:36–09:49:55 adds499s,total100748s (27.99h). Minimum fulfilled without
claiming goal completion. Continue accounting after09:49:55 UTC.

### Independent providers, 2026-09-21 10:03 UTC

Additive private @poe-code/providers-rust provides original registry, auth strategy,
API shape resolution, built-in provider exports and ordered catalog. One JSON
definition per provider; filename supplies identity and build/source generators
derive all exports without provider-ID branches. Rust owns catalog decoding,
identity lookup, primitive credential trimming, ranking and effectful ordered
selection. Node retains provider references, opaque credential-key identity,
callback/store effects, custom trimming/array methods and locale tie sorting.
Rust definition decode returns errors without panics for malformed/non-object data.
Original private TypeScript class branding remains nominal; public methods/types
pass bidirectional structural checks. No production integration or runtime deps.

Missing core/native reds precede implementation. New own/original effect fixtures
reproduce missing IteratorClose result validation, opaque/changing storage-key
handling and custom credential trim failures. Repairs preserve lazy getter reads,
original predicate errors, intrinsic method invocation and map upsert behavior.
A100000-candidate16MiB stress worker fails ERR_WORKER_OUT_OF_MEMORY before repair:
callback handles retained rejected values within one native call. Binding now uses
per-iteration NAPI handle scopes and roots only matched payloads in the outer
result. Same worker passes after repair (sample forced-GC peak5.90MB). Permanent
bounded-heap native regression retained. Broad native allocation audit remains
incomplete; no universal memory superiority/leak claim.

Maintained4 Rust cases,5 native groups,67 full original references/10files,public
method/declaration checks,fmt/clippy,whole new-host ESLint/diff pass. Uncached
maintained selected closure114workspaces/9builds/345edges passes. Packed audit
30JS/declaration files,one addon,zero runtime groups/imports. Direct/packed16MiB
workers each finish4096 registries/8192read-only store reads/4096writes/4096deletes/
16384shape matches/100000rejected generated candidates; forced-GC heap peaks
6.23MB/5.55MB. Root lock contains only two new workspace/link records; original
source and concurrent changes preserved.

Five warmed alternating1024 registry/filter/mocked-credential samples give
original CPU0.681–1.643ms versus own6.069–8.216ms, scoped speed FAIL, identical
credential-unit/match totals. This measures Node/native crossings and mocked
stores,not actual filesystem/network authentication. Evidence out/rust-providers-*.

Agent exportsa74a51f2b exact remote-main delivery verified; release35585521932
pending. Registry35583768081 build/audit/checks/unit-cached success,unit/bash still
in_progress; publication unverified. Missing task-list/poe-code-config/harness
counterparts,wider spawn/runtime/platform/performance acceptance remain.
Continuous09:49:55–10:03:10 adds795s,total101543s (28.21h). Minimum fulfilled without
claiming completion. Continue accounting after10:03:10 UTC.

### Task-list state foundation, 2026-09-21 10:11 UTC

Additive private @poe-code/task-list-rust now provides task interfaces/errors,
default/custom state discovery/assertions, native UTF16 identity/name validation,
and file-operation helpers. Rust exposes standalone Machine validation, ordered
selection, legacy reverse transitions and shortest event paths. Host retains
callback identity, custom source membership, locale/date ordering and filesystem
operations. Missing Rust/native exports failed before implementation. A new
wildcard getter-count test reproduced two target reads; adapter now reads once.
Storage backends, moveTasks and GitHub project sync remain absent: this increment
is not a completed package rewrite and has no production integration.

Maintained6 Rust cases,3 native groups,38 original references/3files,bidirectional
covered-state types,fmt/clippy,host ESLint and diff pass. Uncached maintained
selected closure115workspaces/7builds/347edges passes after fixing native tooling
that overwrote the host index declaration. Packed artifact12JS/declaration files,
one addon,zero runtime groups/imports. Direct/packed16MiB workers each execute
16384identity validations/16384legacy transitions/32768event selections and machine
validations,using7.63/7.48MB final JS heap. Finite artifact/memory evidence only;
no speed,platform or general leak/stability superiority claim. Evidence
out/rust-task-list-*. Root lock scoped to20added workspace/link lines.

Registry release35583768081 remains in_progress; providers35586695819 pending;
publication remains unverified. Concurrent safe-bash/OAuth edits/commits preserved.
Checkpoint active interval10:03:10–10:04:20 adds70s; checkpoint pause excluded.
Continuous10:06:15–10:11:13 adds298s,total101911s (28.31h). Minimum fulfilled;
remaining closure/runtime/performance acceptance incomplete. Continue accounting
after10:11:13 UTC.

### Task-list Markdown storage, 2026-09-21 10:16 UTC

Owned Markdown backend now uses Rust document framing, ASCII numeric filename
parsing and existing own YAML parse/serialize in its single addon. Filesystem,
locking, atomic-write, guard/lifecycle and date/locale effects remain in Node.
Native scanners preserve UTF16,CRLF,one-blank-line stripping,passthrough bodies,
legacy numbered-name fallback and ECMAScript decimal order. Initial missing-module
Rust/native reds precede implementation; reference inspection corrected an overly
strict filename expectation before delivery. openTaskList currently supports
Markdown only; YAML-file/GitHub types still rejected,moveTasks/project sync absent.

Maintained9 Rust cases,4 native groups,78 original references/4files,covered public
types,fmt/clippy,host ESLint and diff pass. Uncached maintained selected closure
115workspaces/12builds/348edges passes. Packed23JS/declaration files,one addon,
zero runtime groups/imports. Direct/packed16MiB workers each execute128creates/
128updates/288event transitions/4096YAML graph roundtrips and reverse ordering,
with128memfs task files. Final JS heaps14.45/15.40MB; RSS96.1/97.7MB. This worker
limit bounds V8 old space,not total process/native memory. No general retention,
platform or stability superiority claim.

Five warmed alternating mocked32task create/plan/update/list/reorder workflows:
original wall25.95–38.81ms/CPU27.95–82.33ms versus own wall19.30–25.67ms/
CPU20.98–44.98ms. Both sample metrics improve in every pair,scoped performance
PASS; this is memfs/local YAML work,not actual disk/network performance or universal
speed superiority. Evidence out/rust-task-list-markdown-*.

State foundation5d2630f12 exact remote-main verified; release35587421213 pending.
Registry35583768081 unit still in_progress; successful publication unverified.
Concurrent original OAuth/safe-bash changes/commits preserved. Continuous
10:11:13–10:15:44 adds271s,total102182s (28.38h). Minimum fulfilled; full
closure/runtime/platform/performance acceptance incomplete. Continue accounting
after10:15:44 UTC.

### Task-list GitHub backend and sync, 2026-09-21 10:21 UTC

Additive GitHub issue/project storage,GraphQL client/auth resolution and project
verification/sync now expose original public APIs. Rust validates canonical decimal
safe issue numbers and exactUTF16 repository components,parses strict GraphQL JSON,
and exposes reusable ordered label-state resolution. Own runner bindings/host
adapter and UserError embed into the same addon without npm runtime imports.
Network,callbacks,project/query orchestration and array-method effects remain in
Node; do not describe this as a completely native backend. GraphQL parse limits
nesting to512 and wraps syntax failures in SyntaxError. No live credentials,
GitHub requests or external mutations used during implementation/tests.

Missing GitHub core/native artifact reds precede implementation. Maintained12 Rust
cases,6 native groups,194full original references/11files,bidirectional covered
public state/open/auth/project APIs/types,fmt/clippy,whole host ESLint/diff pass.
Uncached maintained selected closure115workspaces/19builds/350edges passes.
Packed34JS/declaration files,one addon,zero runtime groups/imports. Direct/packed
16MiB workers each finish4096mockGraphQL queries/4096project verifications/4096
no-op syncs,with own proto metadata,unpairedUTF16 and overflowing-number JSON;
final JS heaps10.67/10.55MB,RSS83.4/85.6MB. Finite coverage only,not full native
allocation/leak/platform stability acceptance.

Five alternating warmed64mockqueries/64items each: originalCPU2.388–3.244ms/
wall2.427–2.892ms versus ownCPU11.486–12.028ms/wall11.434–11.719ms,scoped performance
FAIL. Returning parsed object graphs across NAPI is material overhead versus Node
JSON.parse; no claim of Rust performance superiority. Evidence
out/rust-task-list-github-*. YAML-file storage/migration and remaining closure/full
runtime/performance work remain. Root lock contains only own added dev closure edges.

Markdownffc8af5c6 exact remote-main verified,release35587882109 pending; registry
35583768081 in_progress; publication remains unverified. Concurrent original
OAuth/safe-bash changes/commits preserved. Continuous10:15:44–10:21:03 adds319s,
total102501s (28.47h). Minimum fulfilled without claiming goal completion.
Continue accounting after10:21:03 UTC.

### Current TOML SDK conformance repair, 2026-09-21 10:36 UTC

Supporting-package maintained checks reproduced TOML diagnostic/boolean parsing
mismatches against installed smol-toml1.8.0. Own codec still followed earlier SDK
positions/messages. Existing independent SDK oracle provides failing evidence for
inline redefinition positions,opening-quote string offsets,incomplete declarations,
array/table EOF whitespace boundaries and partial Boolean literals. Repair updates
own Rust parser to the current SDK,retaining separate missing-delimiter,missing-key
and missing-value errors and fixed-length Boolean admission. No SDK runtime import,
original TypeScript modification or dependency pin/workaround introduced.

Maintained config-mutations checks pass89working-tree Rust cases (including5pending
additive syntax-span cases),66native groups,260SDK references/2files,types and
fmt/clippy/binding checks. Independent TOML corpus compares values,temporal flags,
serialized output,diagnostic messages/line/column/codeframes. Task-list working
YAML backend358references and strict numeric-key/node effects pass; delivery of
those separate additions remains pending. Evidence out/rust-config-toml-sdk18-*,
out/rust-config-yaml-document-*.

GitHub1b7449e81 exact remote-main verified,release35588318214 pending. Registry
35583768081 remains in_progress; successful publication unverified. Concurrent
original OAuth/safe-bash changes preserved. Continuous10:21:03–10:36:30 adds927s,
total103428s (28.73h). Minimum fulfilled; remaining closure/runtime/platform/
performance and YAML edited-flow/comment conformance remain incomplete. Continue
accounting after10:36:30 UTC.

### Reusable YAML syntax spans, 2026-09-21 10:37 UTC

Additive config-mutations Rust yaml::document::scan exposes a flat syntax tree,
UTF16 offsets,mapping/sequence/alias structure,flow/quote style and schema-aware
non-string scalar values,without changing existing parse/serialize behavior.
Source offsets count UTF16 units,including unpaired surrogates. Leaves include
following layout rather than exact raw-token endings. Existing own event scanner
supplies grammar; schema classification reuses own scalar resolution. Multiple
documents,depth above512 and more than1048576syntax nodes reject with positioned
errors. This is reusable syntax infrastructure,not a claim of full SDK CST parity.

Initial missing-module/scalar-field reds precede implementation. An EOF regression
reproduces discarded final-line collection spans before repair. Six focused Rust
cases cover comments/flow/aliases/unpaired units/schema key types/EOF and nesting
budget; full supporting-package checks pass89Rust cases before sixth added span
case,66native groups,260SDK references/2files,types,fmt/clippy/binding checks.
Uncached maintained selected closure115workspaces/8builds/350edges passes. README
states source-span semantics and compatibility bounds. Task-list adapter/backend
will be delivered separately after final artifact/source preservation checks.
Evidence out/rust-config-yaml-document-*.

TOML repaira5827f1d7 exact remote-main verified; registry35583768081 still running
fresh unit/native checks (job106287079554). Successful publication unverified;
concurrent original changes preserved. Continuous10:36:30–10:37:46 adds76s,
total103504s (28.75h). Minimum fulfilled; full rewrite acceptance remains incomplete.
Continue accounting after10:37:46 UTC.

### Task-list YAML backend, 2026-09-21 10:40 UTC

Owned YAML backend now supports create/update/fire/delete/move/reorder/list transfer
with std-only Rust value composition and source spans in the same addon. Host
Document/YAMLMap adapter retains unchanged block entries,attached/inline comments,
single/double quote styles for single-line strings,custom indentation and scalar
mapping key types. SDK numeric-key/string-path distinctions retained. Host owns
filesystem,callbacks,locks and atomic writes. Rendering uses source slices rather
than wholesale replacement of unchanged blocks. Initial missing native/backend
reds,empty-map conformance failures,quote/key effects and EOF regression precede
repairs. A memfs test verifies flow-map comment rejection occurs before writes.

Bounds are explicit: complex mapping keys and full SDK alias/formatting edits
remain under review; changed flow maps normalize and edits to flow maps containing
# reject. Root no-integration constraint preserved. Migration still absent; do
not describe task-list as a complete replacement or completely native backend.

Maintained12 task-list Rust cases,12native groups,358full original references/
16files,covered bidirectional APIs/types,fmt/clippy/hostESLint/diff pass; reusable
source module additionally6focused Rust cases. Uncached maintained selected
closure115workspaces/19builds/350edges passes. Packed38JS/declaration files,one
addon,zero runtime groups/imports. Direct/packed16MiB workers each complete64creates/
64updates/80transitions/reorder/2048comment-preserving edits,one memfs store file;
final JS heaps11.44/14.61MB,RSS93.2/96.4MB. V8 limit is not a total memory limit;
full native allocation/platform/stability acceptance remains incomplete.

Five alternating warmed32task YAML memfs create/plan/update/list/reorder samples:
originalwall108.62–134.47ms/CPU119.36–169.13ms versus ownwall75.32–80.76ms/
CPU78.24–92.18ms,better in each pair,scoped performance PASS. No actual disk/network
or universal Rust superiority claim. Evidence out/rust-task-list-yaml-*.

Syntax77318eb79 exact remote-main verified; successful publication remains
unverified. Concurrent original changes preserved. Continuous10:37:46–10:40:33
adds167s,total103671s (28.80h). Minimum fulfilled; remaining full closure/runtime/
platform/performance/edited-YAML acceptance remains incomplete. Continue accounting
after10:40:33 UTC.

### Task-list migration, 2026-09-21 10:51 UTC

Additive moveTasks supports read-only sources, dry-run write guards, single-list
GitHub target fallback, shortest state-event paths, rate limiting, source deletion,
progress callbacks and rollback after transition/source deletion failure. Rust owns
bounded UTF16 BFS queue/visited state and token arithmetic; Node retains observable
property access, filesystem/callback/timer orchestration. Search rejects above
1048576 aggregate UTF16/path units or65536 queued/visited entries without mutation.
Initial missing-module/export reds and resource-budget red precede implementation.
An initial reference redirect gap reproduced four realm failures; repaired redirect
ensures original migration fixtures exercise owned code.

Maintained16Rust cases,13native groups,370original references/17files,full-module
bidirectional public API types,18exact runtime exports,fmt/clippy/hostESLint pass.
Uncached declared selected closure115workspaces/19builds/350edges passes. Refreshed
packed audit40JS/declarations,one addon,zero runtime dependency groups/external
imports. Direct/packed16MiB-old-generation workers each create96tasks,apply96events,
dry-run96moves and migrate192tasks across Markdown/YAML with deletion. Final JS
heaps9.92/9.98MiB,RSS97.8/100.8MiB. V8 bound is not total/native memory bound.
Evidence out/rust-task-list-migration-*; no integration or full YAML/platform/
performance acceptance claim.

Registry release35583768081 remains in_progress; no successful publication
verified. Unrelated auth-store/planning edits preserved. Previously unrecorded
10:40:33–10:47:36 adds423s; fresh10:50:44–10:51:31 adds47s; checkpoint pause excluded.
Total104141s (28.93h),minimum fulfilled,objective incomplete. Continue accounting
after10:51:31 UTC.

### Task-list schema resources, 2026-09-21 10:53 UTC

Added canonical task/store JSON schema resources to owned source and packed dist.
Missing-resource reference red precedes addition. AST redirects schema imports and
schema-ID file reads to owned artifacts. All19original test files now covered:
374cases pass plus16Rust/13native groups,full public types; uncached maintained
selected115workspace/19build/350edge closure and focused host ESLint pass. Packed
resources byte-match canonical originals;40JS/declarations,one addon,zero external
imports/runtime groups. This completes original suite coverage,not all YAML edit
semantics or full native/platform/performance acceptance.

Migration5dbbfbb77 exact remote-main verified; release35590995162 pending;
successful publication remains unverified. Continuous10:51:31–10:53:16 adds105s,
total104246s (28.96h). Continue accounting after10:53:16 UTC.

### Client initialization cleanup conformance, 2026-09-21 11:00 UTC

Registry release35583768081 completed failure: owned client reference suite
failed six current original initialization/receive-stream fixtures. Focused local
suite reproduces6failures/14cases. Ordered POST work escaping the writable async
iterator emits AbortError before pending session deletion completes. Transport now
handles ordered errors before iterator exit and exposes primary closeReason
separately from closed cleanup outcome. Client consumes primary reason when
available; final initialization reads primary reason,not DELETE cleanup error.
Transport disposal aborts outstanding work with primary reason/identity retained.
Original TypeScript production files unchanged.

Maintained39Rust cases,70native groups,344references/43files and types pass;
fmt/clippy/focusedhostESLint pass. Uncached declared selected116workspaces/15builds/
354edges passes. Evidence out/rust-client-initialize-cleanup-*. Prior failure is
reported distinctly from delivery; successful publication remains unverified.
Schema62b31535a exact remote-main verified. Config foundation in progress remains
uncommitted; unrelated concurrent commits/files preserved. Continuous10:53:16–
11:00:15 adds419s,total104665s (29.07h). Continue accounting after11:00:15 UTC.

### Config Rust foundation, 2026-09-21 11:03 UTC

Added private @poe-code/poe-code-config-rust with ./core and root surfaces for scopes,
config store, normalization/merge, readonly/extension reads, atomic recovery/write,
inspection, runtime/memory/provider adapters and callbacks. Rust owns document/scope
policy over opaque handles and primitive coercion; owned extension parsing and
resolution embedded in one addon. Node retains object identity/effects/I/O/custom
JSON parsers/default cloning and current runtime/memory/provider adapters. No
production imports change. Configured-service migration,state registries and
TypeScript schema compiler remain absent,so full config interchangeability is not
claimed. Missing-coercion-module/native-package reds precede applicable additions;
a getter corpus red exposed double field.type reads,now snapshot once per coercion.

Maintained5Rust cases,3native groups,125original references/5files,covered
bidirectional public types,fmt/clippy/hostESLint pass. Uncached declared selected
116workspaces/16builds/354edges passes. Packed49JS/declarations,one addon,zero
runtime groups/external imports. Direct/packed16MiB-old-generation workers each
complete4096merges/4096coercions/128sets/128gets,one memfs store. Final JS heaps
11.43/11.56MiB,RSS77.1/79.1MiB; not a total/native memory bound. Five alternating
warmed64memfs sets/gets+256runtime merges: originalwall5.84–7.64ms/CPU7.99–14.66ms
versus ownwall13.08–16.70ms/CPU16.00–35.75ms; slower each pair,scoped performance
FAIL. Foreign callbacks are expensive; planned plain-data crossing optimization
must preserve getters and opaque identity. Evidence out/rust-poe-config-*.

Client2096f50df exact remote-main verified,release35591743711 pending; prior registry
release35583768081 failed as recorded,successful publication unverified. Concurrent
OAuth files preserved. Continuous11:00:15–11:03:44 adds209s,total104874s (29.13h).
Minimum fulfilled; full closure/runtime/platform/performance objective incomplete.
Continue accounting after11:03:44 UTC.

### Config record snapshots, 2026-09-21 11:08 UTC

Added a single-crossing Rust record graph path for normalization/scope/runtime
merge. Selected values remain opaque host references,including whole unchanged
object/array branches. Nonenumerable own values can participate when the other
layer enumerates the key. Proxies,accessor descriptors,changed host intrinsics,
more than100000handles or inspection depth above512fall back to observable foreign
callbacks. Shared graph records track inspection context: a native fixture
reproduced missing nested runtime fields when an object was first seen as a shallow
scope; repaired promotion retains shallow leaf identity and deep runtime merging.
Missing Rust owned-module red precedes core; shared-shell red precedes repair.

Maintained8Rust cases,4native groups,125original references/5files,types,
fmt/clippy/hostESLint pass. Uncached selected116workspaces/16builds/354edges passes.
Refreshed packed53JS/declarations,one addon,zero runtime groups/imports. Direct/
packed16MiB-old-generation workers each4096merges/4096coercions/128sets/128gets,
one memfs store;final JS heaps12.16/12.07MiB,RSS76.77/78.95MiB. Not total/native
memory bounds. Five warmed alternating64sets/gets+256runtime merge pairs now
originalwall5.15–7.66ms/CPU7.09–15.07ms versus ownwall10.53–15.67ms/
CPU14.24–28.01ms; wall slower in each pair,scoped performance still FAIL. Previous
baseline cannot prove a paired crossing-optimization improvement. Evidence
out/rust-poe-config-owned-*,out/rust-poe-config-shared-shell-red.log.

Foundation580a51ea4 exact remote-main verified,release35592066783 pending;
successful publication remains unverified. Concurrent OAuth work preserved.
Continuous11:03:44–11:08:41 adds297s,total105171s (29.21h). Full objective remains
incomplete. Continue accounting after11:08:41 UTC.

### Harness-tools Rust queue foundation, 2026-09-21 11:18 UTC

Added private @poe-code/agent-harness-tools-rust with a persistent Rust live queue:
plan/message ordering,IDs,cursor,status,duplicate/finished admission and transactional
65536item bound. Node preserves validation submission order,async execution,
listeners,abort handling,path resolution and frozen snapshot/item identities.
Owned agent catalog embedded in the same addon; current participant/hook/stage/
document/sequence/loop-agent/worktree adapters stay in Node. Plan discovery/storage,
runtime/process execution,logs,dashboards and workspace transfer remain absent.
All19dependency-closure names now have additive counterpart directories; existence
is not full implementation/parity acceptance. Wider agent-spawn runtime and
config state/service/compiler surfaces remain incomplete.

Missing Rust queue module/native package reds precede implementation. Eager full
snapshot crossing benchmark128plans+256followups/no listeners measured original
wall7.29–7.73ms/CPU7.16–9.17ms versus ownwall296.15–314.83ms/
CPU295.64–311.62ms,FAIL. Binding now transfers active items and lazily materializes
full snapshots on reads/listener delivery. Permanent fixture validates immutable
old snapshots,stable unchanged item identity,active item identity and every
callback-visible mutation. Five alternating warmed complete384-execution samples
with final all-completed assertions: originalwall6.67–7.87ms/CPU6.68–8.75ms versus
ownwall2.34–2.64ms/CPU2.32–3.77ms,better each pair,scoped no-listener PASS. This does
not establish subscriber/interactive/general performance acceptance.

Maintained3Rust cases+one focused resource-bound case (4total),3native groups,
118original references/8files,forward covered public types and reverse except
loop-agent callback nominal cancellation type,fmt/clippy/hostESLint pass. Original
SDK callbacks accepted by owned API; reversefull-module type cannot match SDK
unique CANCEL symbol with self-contained structural symbol declarations. No
external declaration imports or nominal SDK dependency introduced. Custom array/
intrinsic hooks and invalid untyped outcomes remain under review. Uncached
selected117workspaces/18builds/358edges passes. Packed31JS/declarations,one addon,
zero runtime groups/imports. Direct/packed16MiB-old-generation workers each128queue
cycles,12288executions,12416snapshot publications,256mock workflow agent runs;
final JS heaps11.96/10.88MiB,RSS82.09/86.94MiB. Not total/native memory bounds.
Evidence out/rust-harness-queue-*.

Snapshots44bb7f753 exact remote-main verified,release35592527002 in_progress.
Client35591743711 cancelled by workflow concurrency; no successful publication
verified. Concurrent safe-bash files preserved. Continuous11:08:41–11:18:11 adds
570s,total105741s (29.37h). Minimum fulfilled; full objective remains incomplete.
Continue accounting after11:18:11 UTC.

### Config job/template state registries, 2026-09-21 11:24 UTC

Added complete current state manager/job/template public surfaces. Rust owns lazy
job/template validation,statuses,integer exit codes,safe UTF16 job IDs and matching
template hash admission. Host retains inherited property reads,custom array.every
hooks,entry identity/extra fields,mutation promise queues,atomic/exclusive writes,
symlink traversal checks,dates and locale ordering. Missing state-module/root-export
reds precede additions. Native getter red reproduces premature revoked-proxy shape
classification; separated primitive checks from array/record checks and retained
original repeated reads. Template hash changing type on its second read now yields
normal exclusion rather than conversion failure. No production state changes.

Maintained10Rust cases,6native groups,157original references/6files,covered
bidirectional public types,fmt/clippy/hostESLint pass. Uncached selected117workspaces/
16builds/358edges passes. Refreshed packed63JS/declarations,one addon,zero runtime
groups/imports. Direct/packed16MiB-old-generation workers each4096merges/4096coercions/
128sets/128gets plus32job put/update/get and32template puts/list,34memfs files,no tmp
files. Final JS heaps9.18/11.96MiB,RSS79.13/81.39MiB;not total/native memory bounds.
Five alternating warmed32job memfs put/update+filtered list samples: original
wall5.41–6.54ms/CPU5.66–11.38ms versus ownwall6.53–7.05ms/CPU6.79–13.90ms;
wall slower each pair,CPU mixed,scoped performance FAIL. Evidence
out/rust-poe-config-state-*. Config service migration/schema compiler and wider
harness/execution/platform/performance acceptance remain incomplete.

Harnessf9269f8ab exact remote-main verified,release35593391772 pending; snapshots
35592527002 in_progress. No successful publication verified. Concurrent OAuth/
safe-bash files preserved. Continuous11:18:11–11:24:08 adds357s,total106098s (29.47h).
Minimum fulfilled,objective incomplete. Continue accounting after11:24:08 UTC.

### Configured services, 2026-09-21 11:30 UTC

Added current load/save/unconfigure surfaces, legacy credential migration,
exclusive invalid backups, global/project layer migration and removal rollback.
Rust owns stable UTF16 file deduplication, primitive optional text normalization
and API-shape admission. Owned provider and agent catalogs embed in the same addon;
Node preserves own-property boundaries, literal keys, iterator/map/trim hooks,
extra migration fields, filesystem operations, warning callbacks and rollback.
Missing core-module and redirected original-reference reds precede implementation.
No production integration.

Maintained12Rust cases,8native groups,174original references/7files,bidirectional
covered public types,fmt/clippy/ESLint pass. Uncached selected117workspaces/
19builds/360edges passes. Packed102JS/declarations,one addon,zero runtime groups/
imports. Direct/packed16MiB-old-generation workers each4096merges/4096coercions/
128sets/128gets,32jobs put/update/get,32templates put/list,32service saves/removals;
35memfs files,no tmp. Heaps13.04/12.57MiB,RSS80.86/83.19MiB;not total/native
memory bounds. Five warmed alternating32service saves/normalized reads/removals:
originalwall7.47–9.63ms/CPU8.89–24.32ms versus ownwall14.43–19.01ms/
CPU15.80–34.63ms;wall slower each pair,CPU mixed,scoped performance FAIL.
Evidence out/rust-poe-config-services-*.

State051ca9a96 verified exactly on remote main;release35593905592 pending,
publication unverified. Concurrent OAuth/safe-bash changes preserved. Conservative
restart11:26:15–11:30:47 adds272s,total106370s (29.55h). Unknown interval after
11:24:08 and checkpoint pause excluded. Minimum fulfilled;objective incomplete.
Continue accounting after11:30:47 UTC.

### Stored config JSON crossing, 2026-09-21 11:34 UTC

Stored plain JSON now parses/normalizes in one owned operation,avoiding the
host parse→record snapshot→native normalization pipeline. Last duplicate keys,
literal prototype keys,unpaired UTF16,signed zero,overflow numbers and empty-scope
filtering validated. Changed host parse/enumeration/array intrinsics,callable
proxies and valid JSON beyond512levels retain the host path;invalid JSON uses
original native SyntaxError diagnostics/recovery. Missing stored-core red precedes
implementation. No production integration.

Maintained14Rust cases,10native groups,174original references/7files,types,
fmt/clippy/ESLint pass. Uncached selected117workspaces/19builds/360edges passes.
Packed102JS/declarations,one addon,zero runtime groups/imports. Direct/packed
16MiB workers repeat prior complete workload;heaps11.63/12.00MiB,RSS80.20/82.64MiB,
35memfs files,no tmp;not native-memory bounds. Five alternating warmed128stored
reads of64nested values: baseline owned store fromdc70cffbewall11.41–12.16ms/
CPU11.71–15.14ms,newwall6.39–7.44ms/CPU6.91–12.77ms,wall improves each pair,
one CPU pair slightly worse. Originalwall2.78–3.53ms/CPU2.78–4.77ms;full scoped
performance acceptance still FAIL. Service workload remains slower;state pair
measurements mixed and no general improvement claim. Evidence
out/rust-poe-config-parse-*.

Servicedc70cffbe verified exactly on remote main;release35594515828 pending,
publication unverified. Concurrent OAuth/safe-bash work preserved. Continuous
11:30:47–11:34:58 adds251s,total106621s (29.62h). Objective incomplete.
Continue accounting after11:34:58 UTC.

### Owned static schema compiler, 2026-09-21 12:03 UTC

Added both compiler entry points with an owned Rust static TypeScript lexer,
exported scope extraction, primitive metadata validation, fragment merging and
JSON Schema emission. Node retains source/file access, POSIX module candidates,
Unicode-independent platform path handling, graph traversal and document metadata
hooks. Both original and additive package imports accepted;compiler-free core
entry remains separate. Native source retention defers field extraction until
whole graph collection,matching source/document-getter error phase. Admission
limits16MiUTF16/source,1000000tokens,512delimiter depth,128literal/template depth,
2048files/64Mi units graph;failed file admission retains prior sources.

Missing core and redirected-reference reds precede additions. Differential reds
reproduced/repaired empty required arrays,generic calls/type separators,adjacent
exports,ASI,declaration comparisons,Unicode line separators/escaped identifiers,
non-finite numeric defaults,regexp lexical boundaries and rejection priority.
116normal/error/literal differential comparisons plus graph cycles/import order,
source phase,filesystem injection,resource transactions and owned-import cases
now pass. JSX-like malformed-source recovery differs from ts-morph;the original
forcesScriptKind.TS and can recover/ignore later source,while owned lexer rejects
unterminated strings. This and broader malformed/general TypeScript parsing are
not full replacement acceptance. No production integration.

Maintained18Rust cases,85native groups,all185original references/8files,full
bidirectional public runtime module types,fmt/clippy/ESLint pass. Exact runtime
export membership matches original. Uncached selected117workspaces/19builds/
360edges passes. Packed106JS/declarations,one addon,zero npm runtime groups/
external imports. Direct/packed16MiB workers each128complete17source graph
compilations,2176source visits,16384primitive fields,128nesting rejections;
heaps7.79/7.92MiB,RSS72.89/74.91MiB;not total/native bounds. Five alternating
warmed17source/16scope/128field pairs: originalwall59.66–82.84ms/
CPU102.92–181.84ms versus ownwall0.47–0.67ms/CPU0.47–3.86ms;better each pair,
scoped compiler PASS. This does not repair prior config/state/service performance
failures or prove general Rust advantage. Evidence out/rust-poe-config-compiler-*.

Storee3b5f3587 exactly verified on remote main;release35594857859 in_progress,
audit/build/checks/unit-cached/bash jobs successful,unit ongoing,publication
unverified. Concurrent OAuth/tiny-client/safe-bash changes preserved. Continuous
11:34:58–12:03:03 adds1685s,total108306s (30.09h). Minimum fulfilled;full objective
incomplete. Continue accounting after12:03:03 UTC.


### Locked TOML oracle repair, 2026-09-21 12:14 UTC

CI failures35592527002/35591136884 reproduced against the repository-locked
smol-toml1.7.0: local root1.8.0 had masked69 diagnostic mismatches. Own dev
reference now pins1.7.0,resolves from the own manifest and explicitly rejects
installed-version drift. Original production/root SDK resolution unchanged.
Repaired unterminated string offsets,inline redefinition offsets,empty-value
reasons,primitive diagnostic priority and malformed array/table transitions.
Expanded differential oracle by41malformed-container cases;four additional
string-array reds repaired. Successful value/date/serialization behavior retained.
No production integration.

Maintained90Rust cases,66native groups,260original references/2files pass using
locked1.7;fmt/clippy/host lint pass. Uncached selected117workspaces/8builds/360edges
passes. Newly packed complete SDK passes JSON/TOML/YAML invalid backups,
merge/prune/transform and embedded-renderer scenarios with all external npm
resolution disabled;zero runtime dependency groups. Evidence out/rust-toml-sdk17-*.
Store release35594857859 failed unit;compiler35597375742 still ongoing.
No successful current publication verified. Concurrent changes preserved.
Known12:03:03–12:10:12 adds429s; restart12:13:20–12:14:15 adds55s,total108790s
(30.22h). Checkpoint interval excluded. Minimum fulfilled;objective incomplete.
Continue accounting after12:14:15 UTC.


### Harness workflow discovery, 2026-09-21 12:18 UTC

Added public workflow-path resolution and injected filesystem discovery. Rust owns
default glob policy,UTF16 filename matching,normalized containment admission and
stable exact-name project/global overwrite. Node retains Unicode lowercase,
locale sorting,platform path handling,filesystem ordering/error identity and
own-code checks. Original17path references added;all135references/
9files pass. Core-module/reference missing-surface reds precede implementation;
an invalid direct-helper case reproduced a slicing panic,now rejected safely.
No production integration;original packages retained.

Maintained7Rust cases,6native groups,135reference cases and bidirectional covered
types pass;fmt/clippy pass. Uncached selected117workspaces/18builds/360edges passes.
Packed39files/one addon,no npm runtime groups;discovery/traversal/queue checks pass
with external npm resolution disabled. A16MiB-old-generation worker performs
2048discoveries/262144entry visits/32rejections,retains4.10MiBheap/60.72MiBRSS;
finite evidence,not total/native memory bounds. Five warmed alternating128discovery
pairs with64entries/scope:originalwall4.68–5.88ms/CPU4.65–8.68ms,ownwall9.37–10.14ms/
CPU9.21–10.87ms;scoped performance FAIL. Native crossing cost remains a gap.
Evidence out/rust-harness-paths-*.

TOML792b88388 exactly verified on remote main;release35598431393 pending;
compiler35597375742 ongoing,no successful publication verified. Concurrent files
preserved. Continuous12:14:15–12:18:42 adds267s,total109057s (30.29h).
Minimum fulfilled;objective incomplete. Continue accounting after12:18:42 UTC.


### Harness run-log admission, 2026-09-21 12:22 UTC

Added run-directory resolution/creation,plan slugs and UTC role filenames. Rust
owns ASCII label collapse,basename stem policy and date-component filename
formatting. Node retains SHA256,platform paths,Date getter order,filesystem error
identity and canonical ancestor checks before final creation/after creation.
Injected filesystem without realpath retains original lexical-only admission.
Core/reference missing-module reds precede implementation. Original15run-log cases
run through a memfs-only test adapter,including default filesystem/symlink cases;
no unit disk fixtures created. New30extended-year/invalid-date/Unicode filename
comparisons,sevenpath-digest comparisons,invalid binding-date admission and
canonical/error-identity cases pass. No production integration.

Maintained9Rust cases,9native groups,150references/10files,bidirectional covered
public types,fmt/clippy/ESLint pass. Uncached selected117workspaces/18builds/360edges
passes. Packed41files/one addon,no npm runtime groups,external npm resolution
blocked;discovery/queue/log scenarios pass.16MiB-old-generation worker8192log-dir
checks/8192filenames/128traversal rejections retains4.61MiBheap/57.69MiBRSS;
finite evidence,not total/native bounds. Five alternating warmed512log-dir/
filename pairs:originalwall3.52–4.18ms/CPU4.21–8.74ms,ownwall4.11–4.43ms/
CPU5.55–11.62ms;wall slower each pair,CPU mixed,scoped performance FAIL.
Evidence out/rust-harness-logs-*.

Discovery4b063bd6d exactly verified on remote main;release35598858201 pending.
TOML release35598431393 cancelled by concurrency;compiler35597375742 ongoing
unit,otherjobs successful. No successful publication verified. Concurrent changes
preserved. Continuous12:18:42–12:22:24 adds222s,total109279s (30.36h).
Minimum fulfilled;objective incomplete. Continue accounting after12:22:24 UTC.


### Harness plan discovery/archive, 2026-09-21 12:27 UTC

Added discoverPlans/openPlanList/archivePlan,readiness parse/labels/comparison and
run-queue summaries. Owned task-list hosts/declarations and Rust codec/process
bindings embed in one harness addon;no npm runtime imports/dependencies added.
Rust owns exact markdown-ID extraction,readiness validation/presentation and
summary formatting;Node retains filesystem access,hooks,duplicate paths,task
metadata,archive transition orchestration and modification-time/locale sorting.
Original21reference cases added,including metadata acknowledgement and failed
archive non-overwrite. Core/reference missing-module reds precede additions.
A proposed quoted-format assertion did not match the original:both SDKs normalize
notes quotes during passthrough archive;concrete oracle confirms equal output,
assertion repaired without changing code. Existing YAML editor limitations remain;
this is not full replacement acceptance. No production integration.

Maintained12Rust cases,11native groups,171references/14files,bidirectional covered
public types,fmt/clippy/ESLint pass. Native diagnostics retain JSON hooks/errors,
BigInt/Symbol handling,right-before-left readiness getters,UTF16 labels,embedded
task operations and untouched neighbor files. Uncached selected117workspaces/
26builds/361edges passes. Packed89files/one addon,no npm runtime groups,external
npm resolution blocked;workflow/queue/log/plan discovery+archive checks pass.
16MiB-old-generation memfs worker512discoveries/256archives retains6.06MiBheap/
80.08MiBRSS;finite evidence,not total/native memory bounds. Five alternating warmed
32discoveries of32plans:originalwall58.15–64.71ms/CPU64.84–92.63ms,ownwall33.80–38.15ms/
CPU38.11–47.83ms;scoped plan discovery PASS each pair. Prior simple discovery/log
performance failures unchanged. Evidence out/rust-harness-plans-*.

Logs4dbcb2d1c exactly verified on remote main;release35599205236 pending;
compiler35597375742 unit ongoing. No successful current publication verified.
Concurrent changes preserved. Continuous12:22:24–12:27:55 adds331s,total109610s
(30.45h). Minimum fulfilled;objective incomplete. Continue accounting after12:27:55UTC.


### Harness managed log streams, 2026-09-21 12:33 UTC

Added streamLogFile/waitForExit/wrapForLogTee and public stream types. Rust owns
job-component admission,shell quoting/script construction,canonical decimal exit
validation/parse and complete UTF8 prefix detection over borrowed Buffers. Node
retains filesystem/symlink checks,own error-code admission,byte offsets/pending
buffers,watchers,timers and abort cleanup. Missing core/reference reds precede
implementation. Exact nineUTF16 shell comparisons exposed/fixed an extra closing
brace in the own formatter. A synchronous injected watch notification reproduces
an original watcher leak(oracle closes0);own adapter now releases that returned
watcher once and suppresses repeated completion. Original package unchanged.
1280tail-byte framing comparisons,overflow exit numbers and host error identity
covered. Original incomplete trailing bytes at exit behavior retained.

Maintained16Rust cases,15native groups,194references/15files,bidirectional covered
types,fmt/clippy/ESLint pass. Uncached selected117workspaces/26builds/361edges passes.
Packed93files/one addon,no npm runtime groups,external npm resolution blocked;
all prior scenarios plus log replay/exit/quoting pass.16MiB-old-generation worker
8192replays/8192exit reads/92274688bytes retains5.19MiBheap/59.22MiBRSS;
finite evidence,not total/native memory bounds. Five alternating warmed1024replay/
exit pairs with11264bytes/replay:originalwall19.40–21.60ms/CPU18.76–30.86ms,
ownwall19.48–24.46ms/CPU19.18–36.18ms;pair results mixed,performance acceptance
FAIL(no consistent improvement). Evidence out/rust-harness-stream-*.

Plans0d614bf69 exactly verified on remote main;release35599744513 pending;
compiler35597375742 completed failure,investigating unit log. No successful current
publication verified. Concurrent changes preserved. Continuous12:27:55–12:33:13
adds318s,total109928s(30.54h). Minimum fulfilled;objective incomplete.
Continue accounting after12:33:13UTC.


### Harness execution-factory registry, 2026-09-21 12:40 UTC

Added register/select execution-factory APIs and complete owned public execution
interfaces. Rust assigns immutable slots by exact UTF16 runtime name,with65536
name budget and transactional rejection;replacement reuses slots. Node retains
factory callbacks/references and caches immutable IDs,avoiding native calls for
known replacements/selections. Slot IDs never move/remove,so cache is valid.
Embedded owned config/process declarations require no original SDK consumer types;
dev bridges are not packaged. Built-in execution factories remain unregistered.
Missing core/reference reds precede implementation. Max-capacity replacement,
exact names/unpairedUTF16,independent native registries,factory identity/getter
order and unknown-type diagnostics covered. No production integration.

Maintained18Rust cases,17native groups,198references/16files,bidirectional covered
types,fmt/clippy/ESLint pass. Uncached final selected117workspaces/30builds/362edges
passes. Packed146files/one addon,no npm runtime groups,external npm resolution
blocked;all prior scenarios plus registration/replacement/selection pass.
16MiB-old-generation worker131072replacements/131072selections retains5.06MiBheap/
56.47MiBRSS;finite evidence,not total/native bounds. Before caching65536warm
replacement/selection pairs ownwall15.62–16.50ms vs original0.79–1.08ms,FAIL.
After caching five alternating pairs originalwall0.81–1.47ms/CPU0.79–3.22ms,
ownwall0.76–0.84ms/CPU0.76–0.84ms;better each pair,scoped cached registry PASS.
This measures Node cached dispatch,not Rust computation or new-name admission.
Evidence out/rust-harness-env-*.

Streama7a62ea5c exactly verified on remote main;release35600258716 pending;
plans35599744513 in_progress. Compiler35597375742 unit failed the known pre-fix
TOML oracle;current main contains the delivered repair. No successful publication
verified. Concurrent changes preserved. Continuous12:33:13–12:40:51 adds458s,
total110386s(30.66h). Minimum fulfilled;objective incomplete.
Continue accounting after12:40:51UTC.


#### Manual command process-group check (completed on macOS)

1. Supply the owned host execution factory to the additive harness command API.
   Use in-memory job state; reject any pre-existing randomly generated job paths.
2. Run an isolated Node parent/child group with no model/network calls. The child
   ignores SIGTERM. Capture its PID and apply a short inactivity timeout.
3. Verify ActivityTimeoutError,lost job status and child termination after grace.
   Clean only the newly created job log paths and any surviving owned processes.
   Retain results under out;this is separate OS evidence,not a unit-suite pass.


### Harness command execution/sessions, 2026-09-21 12:50 UTC

Added runPoeCommand/createPoeCommandSession. Rust validates finite positive activity
timeouts,encodes ULIDs(timestamp low50bits/80entropy bits) and tracks committed
pending/running/terminal job phase with remove/lost/no-op failure action. Node
retains streams/promises,cancellation,input-error identities,capture/draining,
workspace operations,caller state,detached context and session reuse. Missing
core/reference reds precede implementation. Original26in-memory reference cases
added;the single actual process-group/disk-fixture case is excluded from unit
membership,not counted as skipped/passing. Original state SDK is a dev test fixture;
public types are owned/self-contained. No production integration.

Maintained21Rust cases,20native groups,224references/17files,bidirectional covered
public types,fmt/clippy/ESLint pass.224deterministic BigInt/entropy ID comparisons
include high words/negatives;invalid entropy and invalid lifecycle transition
admission covered. Command callback/error identity,terminal job metadata,session
reuse and untouched I/O identities covered. Uncached selected117workspaces/
30builds/362edges passes. Packed150files/one addon,no npm runtime groups,external
npm resolution blocked;all prior scenarios plus mocked command/session state pass.
16MiB-old-generation worker4096sync/4096session commands with caller-owned job
entries cleared retains5.38MiBheap/65.95MiBRSS;finite evidence,not total/native bounds.
Five alternating warmed1024mock command pairs:originalwall9.98–11.95ms/
CPU12.05–22.58ms,ownwall7.34–11.12ms/CPU7.01–25.88ms;four wall pairs improve,
CPU mixed,consistent-performance acceptance FAIL. Evidence out/rust-harness-command-*.

Separate executed markdown QA above:owned host factory,real isolated parent/child
group,child ignoringSIGTERM,300msinactivity limit. Final run produces
ActivityTimeoutError,lost status and terminated child after escalation;owned
managed paths removed. First two attempts used malformed nested JavaScript;first
cleanup masked that setup error withESRCH. Corrected generated argument and cleanup
then passed;earlier owned artifacts recovered by unique input/attempt-time window
and removed. No LLM/network calls;not a unit-suite or cross-platform pass.

Registrybe7571002 exactly verified on remote main;release35601000332 pending;
plans35599744513 in_progress. No successful current publication verified.
Concurrent changes preserved. Continuous12:40:51–12:50:11 adds560s,total110946s
(30.82h). Minimum fulfilled;objective incomplete. Continue accounting after12:50:11UTC.

### Config-extends addon embedding repair, 2026-09-21 12:58 UTC

Harness embedding reproduced E0432: resolution.rs imported snapshot_value from
crate root although its owner can be nested. Importing from the parent module
preserves standalone behavior and uses the correct embedded snapshot converter.
Maintained36Rust cases,19native groups,117original references/5files and
fmt/clippy pass. Uncached selected harness closure117workspaces/30builds/362edges
also passes with the nested SDK. Evidence out/rust-config-extends-embedding-* and
out/rust-harness-execution-unit.log. No production imports changed.

### Harness runtime configuration resolution, 2026-09-21 12:58 UTC

Added applyRuntimeOverrides/resolvePoeCommandExecution and capability error/types.
The entire owned config SDK and task-list SDK share one harness addon; SDK hosts
and declarations are embedded with AST-rewritten native loader paths, including
nested agent loaders. Rust requests capability facts lazily in original detach
then transfer priority. Node retains configuration I/O,parse/resolve SDK adapters,
getters,caller state/open-spec identities and foreign exception identities. Missing
core/reference reds and nested-binding compiler red precede implementation.

Maintained23Rust cases,22native groups,230original references/18files and covered
module type parity pass;fmt/clippy/ESLint pass. Uncached selected117workspaces/
30builds/362edges passes. Packed one addon with zero npm runtime dependency groups
passes all prior scenarios plus runtime resolution/override/capability checks with
external npm resolution blocked. Evidence out/rust-harness-execution-*.

Five alternating warmed pairs of1024runtime resolutions over absent config paths
and caller-supplied in-memory state:originalwall3.87–6.39ms/CPU3.83–24.06ms,
ownwall6.24–9.10ms/CPU6.22–15.84ms. Wall slower in all pairs;performance acceptance
FAIL.16MiBold-generation worker8192resolutions/128capability rejections retains
6.03MiBheap/67.08MiBRSS;finite local evidence,not native/total/platform bounds.
No production integration,real config mutations or model/network calls.

Config embedding3bbe07d17 pushed and remote delivery checked separately. Plans
release35599744513 in_progress;command35601923765 pending. No successful current
publication verified. Concurrent changes preserved. Continuous12:50:11–12:58:45
adds514s,total111460s(30.96h). Minimum fulfilled;objective incomplete.
Continue accounting after12:58:45UTC.

### Harness workspace transfer SDK, 2026-09-21 13:01 UTC

Added uploadWorkspace/downloadWorkspace and owned transfer types through direct
exports of the embedded process-runner hosts. The already embedded runner Rust
bindings own ignore/hash/conflict/upload-transaction policy; no duplicated core or
proxy functions. Source types use a dev-only bridge;packed declarations are owned.
Missing-module reference red precedes implementation. No production integration.

Maintained23Rust cases,22native groups,261original references/19files(including
31transfer cases),covered types,fmt/clippy/ESLint pass. Uncached selected117workspaces/
30builds/363edges passes. Packed214files/one addon with external npm resolution
blocked and zero runtime groups passes upload filtering,refusal/overwrite and all
prior cases.16MiBworker256memfs roundtrips retains6.65MiBheap/82.92MiBRSS. This
is the same measured owned process-runner algorithm;no new speed/total-memory claim.
Evidence out/rust-harness-transfer-*;earlier out/rust-process-workspace-* still
provides comparative policy/rollback/performance evidence. Original SDK remains
dev-only. Runtime8e1f803e4 exactly verified on remote main. Plans release35599744513
in_progress;no successful current publication verified. Concurrent edits preserved.
Continuous12:58:45–13:01:27 adds162s,total111622s(31.01h). Minimum fulfilled;
objective incomplete. Continue accounting after13:01:27UTC.

### Harness binary probe definitions, 2026-09-21 13:06 UTC

Added createBinaryExistsDetectors and detector/result types. Rust supplies exact
UTF16 command/argument templates and portable exit/output validation policy.
The shell program never incorporates the caller's name;it uses a positional
argument. Node admits immutable templates once and constructs fresh argument
arrays/callbacks with original lazy field reads and JavaScript trimming. No probe
is executed. Missing core red precedes implementation. No production imports changed.

Maintained25Rust cases,24native groups,262references/20files,covered types,
fmt/clippy/ESLint pass. Native comparisons cover Unicode/surrogates/NUL/hostile-name
programs,exit numeric/type boundaries,Unicode whitespace,array independence,getter
order and exception identity. Uncached selected117workspaces/30builds/363edges
passes. Packed216files/one addon,no runtime groups and external npm blocked passes
all prior cases plus binary probes.16MiBworker65536constructions/196608mocked
validations retains5.77MiBheap/60.59MiBRSS;finite evidence,not total/native bounds.

Initial8192constructions/24576validations per pair:own20.69–23.75ms vs original
0.41–1.25ms. Cached immutable admission removes per-probe crossings:own0.50–0.60ms/
CPU0.50–2.31ms vs original0.31–1.03ms/CPU0.31–2.08ms. Four of five wall pairs remain
slower;consistent-performance acceptance FAIL. Measures Node callback hot paths,
not Rust computation or startup. Evidence out/rust-harness-binary-*.

Transfer45c27af4c exactly verified remote main. Plans release35599744513 now fails
unit in mcp-oauth-rust(instead of the earlier repaired TOML scope). Build/audit/checks/
cached-unit/Bash pass;publication skipped. Detailed evidence saved under
out/rust-harness-plans-release-failure.log;next scope is validating those OAuth
failures. No successful publication verified. Concurrent edits preserved.
Continuous13:01:27–13:06:24 adds297s,total111919s(31.09h). Minimum fulfilled;
objective incomplete. Continue accounting after13:06:24UTC.

### Auth-store pure backend selection, 2026-09-21 13:16 UTC

Added resolveSecretStoreBackend and its declaration/shared-runtime export. Portable
Rust separates backend selection from host platform admission;createSecretStore
continues to reject Keychain creation outside macOS. The pure API does not read
platform/store configuration or credentials. Missing core red precedes implementation.
Native tests compare current SDK choices,Unicode trimming,unsupported diagnostics,
short-circuit getter order and custom environment names. Original SDK is dev-only.

Maintained7Rust cases/20native groups/types,fmt/clippy/ESLint pass. Uncached selected
117workspaces/5builds/363edges passes. Packed9files/one addon with zero runtime
npm groups/external npm blocked passes selection and a memfs encrypted-store/lock
roundtrip.16MiBworker262144selections/128rejections retains4.35MiBheap/52.22MiBRSS.
Five alternating warmed65536selection pairs:ownwall27.33–29.04ms/CPU26.11–27.06ms,
originalwall1.27–1.66ms/CPU1.26–2.57ms;performance acceptance FAIL for repeated
tiny selectors. Normal persistence creation uses selection once;no broader speed
or memory claim. Evidence out/rust-auth-backend-selector-*.

Harness binary5632de473 exactly verified remote main. OAuth native fixes remove
known callback/header/API reds,but the full reference route exposed77failures/
606cases in provider option/request ownership,persistence snapshots,cancellation,
fragment and clock contracts. Some original source edits are concurrent;they are
preserved and used only as dev references. OAuth work remains uncommitted/incomplete.
No successful release verified. Continuous13:06:24–13:16:33 adds609s,total112528s
(31.26h). Minimum fulfilled;objective incomplete. Continue accounting after13:16:33UTC.

### OAuth current SDK contract alignment, 2026-09-21 13:26 UTC

Reproduced release OAuth failures through the maintained package route, then
aligned callback multiplicity/error branding, Fetch ByteString token headers,
refresh validation order, raw issuance anchors, owned provider/request/discovery/
persistence snapshots, empty fragment boundaries, native issuer query/security
admission before credential reads, and cancellable host completion. Transaction
leases stay owned until actual backend/operation completion even when callers
cancel. Initial grants call the clock only for unanchored relative expiry and
retain original callback exceptions. No production integration or external
application writes. Concurrent original OAuth fixes used as dev references and
preserved. New native cancellable helper and portable clock/issuer regressions
are additive; concrete reds precede changes.

Maintained62Rust cases,95native groups,617references/40files and covered types
pass. fmt/clippy/ESLint pass. Uncached selected117workspaces/8builds/363edges
passes. Packed27files/one addon/23auditedJS+declarations,zero runtime npm groups
and external resolution blocked passes the finite broad mock workload. Direct
and packed16MiBworkers each complete512callback cycles(384success/128abort),
1024authentications,3072transactions,8192token imports and thousands of owned
credential/identity/policy transitions. Retainedheap9.76/9.82MiB;shared-process
RSS177.47/200.27MiB is not isolated native memory or a bound.

Five alternating warmed4096raw grant imports:Rustwall37.88–43.34ms vs original
17.36–18.34ms. Performance acceptance FAIL for this tiny repeated adapter path;
no overall Rust speed/memory/stability claim. Evidence out/rust-oauth-alignment-*.
Latest prior auth20c07afa3 exactly verified on remote main. Release35604633840
pending;35602764806 in_progress;plans35599744513 failed OAuth unit/publication
skipped. No successful current publication verified. Continuous13:16:33–13:26:01
adds568s,total113096s(31.42h). Minimum fulfilled;full objective incomplete.
Continue accounting after13:26:01UTC.
