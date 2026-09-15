# MCP 2026-07-28 protocol migration

## Continuation evidence

### Nested inputs, output schemas, and immutable definitions

Nine nested-input regressions failed against the former method/object-only checks. The modern validator now uses the transitive official 2026-07-28 input request/response/capability definitions (47 definitions), compiled lazily with local references through toolcraft-schema. Source URL, SHA-256, and the upstream licensing-transition notice accompany the focused artifact. Two narrower generated JSON types are deliberately adapted to the normative TypeScript definitions: JSONValue permits null/fractional numbers; elicitation responses permit fractional numbers. A valid sampling metadata regression reproduced the upstream-generated mismatch before adaptation.

Eight cyclic/non-JSON or elicitation-mode regressions, four sampling-tool/URL regressions, three malformed retry-response regressions, and three malformed known-capability regressions failed before their fixes. The existing JSON guard is now a focused shared module so input validation rejects cycles/accessors/non-JSON values and bounds depth/nodes before recursive schema evaluation. Elicitation supports implicit form mode for empty capabilities; explicit URL/form requests require that mode. Sampling tools/toolChoice and tool-enabled histories require sampling.tools. Invalid URL syntax is rejected with URL parsing, without fetching/opening URLs.

Eight modern output regressions failed at the old object-root-only registration check. OutputSchema/TypedOutputSchema now distinguish unrestricted JSON Schema objects from object-root tool inputs; the HTTP API reexports and accepts the same types. Modern scalar/array/null/union results are validated and retain structuredContent. Legacy clients omit incompatible outputSchema descriptors and receive unstructured content. The old schema-document guard test now rejects boolean documents, since the MCP outputSchema envelope is still a JSON object. The output/legacy suites pass 45 tests.

Three definition/list snapshot regressions failed before isolating registered tool schema/metadata copies and list results. Both tool registration routes compile their snapshots, so mutations of caller schemas or returned descriptors cannot change private validation or cached header descriptors. Focused snapshot/envelope/protocol tests pass 46 tests.

A discovery regression reproduced acceptance of missing metadata. server/discover now requires the modern metadata envelope; prior migration tests were corrected to send actual modern requests. Discovery/request tests pass 29 tests. Eleven sampling sequence regressions genuinely fail against the old behavior and pass with sequence validation; matching results may arrive in any order, but must be the immediate user message and must contain only tool results. The first history matrix incorrectly spread message arrays; it was corrected, and the actual red/green rerun is recorded in /tmp/mcp-sampling-sequence-confirmed-red.log and /tmp/mcp-sampling-sequence-confirmed-green.log. The MRTR/sequence suites pass 60 tests. Single-array cases in discovery/results were similarly wrapped correctly.

Focused ESLint, selected seven-build HTTP closure, and repository type contracts pass. The fresh full core/HTTP/client focused run passes 1,839 tests across 59 files. HTTP client memory bounds are separately committed as 982383dd7; the proposed README row still awaits explicit user approval.

A further direct legacy SDK capacity regression failed because calls without MessageRequestContext bypassed maxActiveRequests. All calls now share the active-request budget. An initial implementation changed established legacy session-close results; the existing ten admission regressions caught that incompatibility. Direct legacy SDK calls preserve their lifecycle signal/result behavior while retaining bounded ownership, and modern/explicitly cancellable calls retain suppression after cancellation. The maintained admission, cancellation, and main core suites now pass all 336 tests. Focused ESLint and the selected seven-build HTTP closure pass. A final type-contract rerun also passes.

Default client negotiation, modern version advertisement, subscription teardown/limits, state integrity helpers/consumers, bounded I/O/backpressure, auth, and the complete consumer audit still remain. The minimum nine-hour requirement is not met.

The HTTP CLI lacked parity for the new SDK maxActiveRequests option. Two focused tests failed before adding --max-active-requests; CLI forwarding, help, decimal validation, and nonpositive-limit checks now pass (28 tests). The maintained selected HTTP build closure passed seven builds. The maintained screenshot command generated screenshots/node-packages-tiny-http-mcp-server-dist-cli.js-help.png; visual inspection confirms readable, aligned help with the correct across-connections scope.

The July specification requires -32021 with data.requiredCapabilities and HTTP 400 for capabilities necessary to process a request. Two new core/HTTP tests reproduced the former internal-error/HTTP-200 behavior. Interim-result validation now reports the missing capabilities together, and the HTTP status mapping includes this code. The focused MRTR/HTTP suites pass 31 tests. Nested input-request schema/mode validation remains outstanding.

Eight new result regressions reproduced rejection of legal modern JSON structured content and acceptance of nonfinite, undefined, BigInt, and cyclic values. Modern validation accepts JSON scalars/arrays/null and rejects unrepresentable values with bounded traversal, while legacy envelope behavior remains intact. Focused modern-results and legacy protocol-features suites pass 59 tests. Output schema registration still restricts object roots and requires a separate migration. The public structuredContent type and consumer handling need declaration and integration verification before committing.

Repository lint completed successfully; the bounded subject-capacity fix is locally committed as 9894b8984 with its separate plan. The broad test run exited with failures, including safe-python codec failures and MCP red-phase regressions sampled while fixes were in progress. These are unresolved broad verification failures, not a clean baseline. After the shared build closure finished, the current core/HTTP/client suites passed 1,756 tests across 53 files. The structured-content accessor regression now also passes (60 modern-results/legacy protocol-feature cases). No push or release has been requested or performed. The nine-hour goal remains active and incomplete.

Part of the at-least-nine-hour production-readiness goal in mcp-production-readiness-20260914.md. This migration is required by the actual latest specification; OAuth hardening alone does not satisfy the goal.

## Authoritative requirements

Use the official 2026-07-28 specification pages for basic protocol, versioning, server/discover, subscriptions, caching, stdio, Streamable HTTP, and schema. The official llms.txt index locates these pages. Do not assume the installed 1.x reference SDK implements this revision.

| Requirement | Current evidence | Implementation and verification |
| --- | --- | --- |
| Discovery before any handshake | Core previously returned Server not initialized | Add server/discover with actual supported versions, shared capability derivation, identity, cache fields, malformed metadata rejection, and stdio wire tests |
| Stateless per-request version and capabilities | Shared core gates methods on lifecycle.initialized; client sends initialize | Parse required own metadata fields per request; reject missing/invalid fields; process modern calls independently; verify mixed clients cannot alter each other's request behavior |
| Version rejection | Client pins 2025-03-26; server negotiates legacy versions | Implement -32022 with requested/supported fields; modern requests must not initialize; dual-era client discovery/fallback must follow transport-specific rules |
| Complete/interim results | Shared result types have no discriminator | Add required complete discriminator to modern results; preserve legacy behavior; support and validate input_required without treating it as final tool output |
| Cache hints | List/read results omit TTL/scope | Include nonnegative TTL and explicit cache scope on modern cacheable results; prevent authorization-context leakage; preserve caller hints where valid |
| Modern notification subscriptions | Core stores resource subscriptions per lifecycle; HTTP uses GET streams | Implement subscriptions/listen with first acknowledgment, exact request-ID tagging, explicit filters, bounded concurrent subscriptions, cancellation, and closure; route HTTP notifications on the originating POST stream |
| Modern HTTP metadata/header validation | HTTP requires initialized session IDs for ordinary requests | Handle modern requests without minting/echoing session IDs; validate standard header/body agreement; return required HTTP and JSON-RPC errors; ignore obsolete modern-session/replay headers |
| Custom parameter headers | Client sends tool arguments only in body | Validate x-mcp-header schema annotations, encode primitive values without header injection, mirror values, and reject server mismatches according to -32020 semantics |
| Request cancellation | Core admits tool calls but handlers receive arguments only | Correlate cancellation with request IDs, expose request cancellation to handlers, abort on HTTP disconnect, suppress messages after cancellation, retain capacity for non-cooperative work until it settles |
| JSON Schema/content changes | CallToolResult structuredContent is object-only | Support JSON Schema 2020-12 keywords and any JSON structured content; use shared bounded validation with remote references disabled by default |
| Legacy compatibility | Existing SDK and consumers use initialization/session semantics | Keep explicit legacy handling scoped to legacy connections; test modern-only, legacy-only, and dual-era peers on HTTP and stdio; avoid advertising unimplemented modern capabilities |
| Integration parity | Toolcraft, SafeJS, Poe agent, and harnesses consume tiny client/core | Audit their result handling, subscriptions, lifecycle, public types, and argument parity; verify consumer tests and published declaration surfaces |

## Implementation boundaries

Keep protocol validation and result adaptation in focused shared-server modules. Keep HTTP framing, header encoding/validation, and stream ownership in transport modules. Keep discovery/version selection and caller-facing APIs in the client. Core CLI/SDK entrypoints wire packages. Do not introduce provider-dependent branches.

Modern requests must not mutate legacy initialization state or inherit capabilities from earlier requests. Subscription state is attached only to explicit active listen requests and released on cancellation/transport closure. Response metadata must reflect the actual request and server identity. Public API changes need SDK/CLI parity where applicable.

## Validation gates

Write failing regression tests for each behavioral change before implementation. Use in-memory transports and memfs; do not query LLMs or create fixture files. Unit tests cover wire metadata, malicious shapes, isolation, resource limits, ordering, cancellation, and cleanup. Execute manual interoperability steps as Markdown QA, not a QA script. Screenshot any affected visual CLI behavior.

Run maintained focused suites and selected workspace build closures for each atomic improvement. Run npm test and repository lint for the shared/cross-workspace migration. Inspect all broad-check failures and resolve their concrete causes. Do not report a clean full gate from focused results. Commit specific edited files and related plans in atomic Conventional Commits; push only when requested and monitor any resulting release to successful publication.

## Current state

Discovery behavior is under implementation with 12 passing core tests. The server still implements legacy protocol revisions; completing the stateless path and transport/client migration is outstanding. Repository-wide npm test and lint have been started to check the shared-core change; results are pending, with Python runtime test failures already observed in the full test process.

Stateless shared-core dispatch is now under implementation. Thirteen initially failing tests verify modern list/read/tool calls, missing capability metadata, unsupported versions on legacy connections, removed-method rejection, and preservation of legacy initialization state. Twelve result tests verify discriminators, undefined result handling, valid/invalid TTL and cache scope, extra metadata preservation, and revised missing-resource error semantics. These 25 tests plus 12 discovery tests pass. Modern subscriptions, request cancellation/correlation, MRTR handling, client support, and HTTP metadata/framing remain incomplete. Do not treat current acceptance of modern metadata as a completed migration or publish it before these requirements are verified.

Focused ESLint, repository lint:types (including SafeJS and tiny-client declaration contracts), lint:workflows, and the tiny-http-mcp-server selected workspace build closure pass. Combined client/core/HTTP verification passed 1597 tests but one real-process smoke test returned EOF before a response while build/check processes were running; its focused recheck is tracked separately. Repository lint:eslint stopped at the maintained 12000-subject input limit with an incomplete receipt. The full npm test process remains live and has exposed Python runtime failures; no clean full gate is claimed.

### Subscription, cancellation, and MRTR progress

The shared core now has explicit modern notification subscriptions with per-request ID tagging, first acknowledgment, opt-in filters, URI filter snapshots, and cancellation. A shared default limit of 128 active requests counts subscriptions and ordinary work. Noncooperative cancelled operations retain capacity until their underlying promises settle. Cancellation removes queued tools from admission, caller abort signals cancel request ownership, and duplicate active IDs cannot replace the original owner. Input EOF ends stdio subscriptions while preserving pending ordinary responses. The initial cancellation regression tests reproduced both queued-handler execution after cancellation and dropped ordinary EOF responses; both now pass. No AbortSignal.any dependency was added; maintained compatibility tests cover runtimes without it.

MRTR validation now restricts input_required to tools/call, prompts/get, and resources/read, requires input requests or opaque state, checks the basic input-request envelope against client-declared capabilities, and rejects malformed retry parameter containers before handler invocation. Registered tool/prompt/resource handlers receive request context and can return interim results without final-output validation. HTTP tool wrappers preserve request context and authentication context; public exports include the added types. Full per-method nested input schema validation, elicitation mode capabilities, signed state patterns for concrete tools, and modern client retry behavior remain outstanding.

Modern envelope tests reproduce nullable and fractional IDs being accepted and no-ID tools executing side effects. Modern stdio/SDK now reject invalid IDs and ignore inappropriate modern notifications. Explicit legacy parser behavior is preserved. The latest shared-core run passes 876 tests. The previous combined client/core/HTTP run passes 1634 tests; HTTP handler-context regressions are included. Selected tiny-http-mcp-server build closure and repository lint:types pass after handler API wiring. A newer combined verification will be required after transport/client implementation.

The first 10 modern HTTP integration tests all fail against the existing legacy transport. They establish that ordinary discover/list/call requests currently require sessions, obsolete session headers affect modern requests, required header/body mismatches and capabilities are not validated with modern error semantics, and removed modern GET/DELETE routes remain enabled. Implement these routes next, then add streaming subscription/disconnect/capacity/header-encoding tests before claiming HTTP compliance.

The broad npm test run completed with 49 failed files, 359 failed tests, 116872 passing tests, and one unhandled loopback EPERM exception. This is a failed diagnostic gate, not a clean verification. Many reported failures involve Safe Python or network adapters and need focused reproduction/environment analysis. Repository lint:eslint failed its finite 12000-subject capacity guard; lint:workflows and lint:types pass. Do not ignore these failures, bypass maintained routes, or infer production readiness from focused passes. No push or release has been performed. The goal remains active; the nine-hour elapsed requirement is not yet satisfied.

### Modern HTTP and shared headers progress

The initial modern HTTP regressions now pass. Modern requests are routed before legacy session admission, carry required standard mirrors, reject header/body mismatches with -32020, reject batches and removed modern GET/DELETE routes, and do not mint or echo sessions. The modern response owns a message session and cancellation controller; response disconnect or transport shutdown cancels that request. Subscription acknowledgment flushes headers immediately and uses X-Accel-Buffering: no. Legacy stateless HTTP capability advertising remains transport-specific; disabling legacy sessions no longer disables modern subscriptions. The full HTTP suite passed 424 tests before parameter-header integration.

The shared headers utility is locally committed as 9d7cade34. It provides token/type/path validation, bounded schema traversal, exact property extraction, safe primitive conversion, Base64 sentinel handling, strict UTF-8 decoding including BOM preservation, and rejection of inherited or unsafe values. Server registration snapshots the annotation descriptors; modern HTTP supplies the raw headers for validation before tool execution. The latest core/HTTP suite passes 1356 tests, including nested Unicode parameter mirrors and rejection of missing or mismatched headers. The HTTP and shared-core migration itself remains uncommitted and incomplete.

The tiny client transport now emits modern standard headers, ignores obsolete modern response sessions, and forwards matching JSON-RPC errors carried by HTTP error statuses without disposing the connection. Its two initial regression tests failed before the fix. The client improvement is locally committed as 4574217eb after the selected workspace build, ESLint, and full 370-test client suite passed. Default McpClient negotiation and per-request metadata are still legacy and must be upgraded. Custom header schema filtering/caching, explicit subscriptions, transport-level cancellation mapping, MRTR retries, and bounded parsing remain outstanding.

Do not parallelize dependency-dist rebuilding with suites that spawn processes importing those dist directories. An overlapping client build/test run again returned EOF in its stdio smoke case; the focused smoke check and a full subsequent client run pass after the build. The exact prior cause is not proven by that timing alone.

Modern HTTP output limits/slow-consumer behavior and keepalive timers require additional tests. Existing maxStreamBufferBytes documentation describes buffered GET stream bytes; the new modern writer currently also counts the next complete frame before write. Validate zero/small limits against documented semantics and improve the bounded writer before committing the transport. Modern notification error status handling, missing-required-capability errors, full nested MRTR request validation, schema/content loosening, and modern version advertisement remain outstanding. The latter must not advertise unsupported functionality prematurely. Overall production readiness and the minimum nine-hour requirement remain unproven.

### Discovery advertisement and subscription admission

- Confirmed three discovery regressions: accepted modern revision was absent from discovery and unsupported-version responses. Advertise 2026-07-28 first; explicitly exclude it from legacy initialize negotiation. Discovery, modern requests, subscriptions and MRTR: 88 tests passed.
- Confirmed four subscription admission regressions: unlimited count/length and relative/empty resource URI filters were acknowledged. Limit to 1024 absolute URI entries and 8192 characters each before acknowledgement or retention. Use a private Set for update matching. Focused subscription tests: 14 passed. These are internal safety bounds, not new public configuration.
- Structured JSON validation committed locally as af6ef211f; no push requested.

### Client discovery work in progress

- Default connection probes server/discover with modern metadata, timeout bounded by the caller timeout and one second, then uses initialization fallback for unrecognized errors. Recognized modern -32020/-32021/-32022 errors are preserved without fallback.
- Modern connection result uses ConnectResult with optional serverInfo; absent optional discovery identity stays absent rather than being invented. Modern metadata attached centrally to subsequent JSON-RPC requests, preserving existing request metadata.
- Confirmed four negotiation failures with corrected raw protocol-error fixtures; green four tests. Confirmed two HTTP400 fallback failures; green six combined tests.
- Historical SDK/transport fixtures explicitly select legacy protocolVersion 2025-03-26 so they continue testing legacy handshake, sessions, notifications and cancellation. New default modern coverage is separate. New optional protocolVersion preference and ConnectResult need README permission before documentation additions. This preference avoids discovery only when explicitly selecting the legacy revision; default retains both eras.
- Client-wide validation initially 120 failures, largely historical handshake fixture assumptions; active rerun follows fixture clarification. Modern subscriptions/MRTR/result-envelope enforcement remain required follow-up before this migration is ready to commit.

### Modern client result and MRTR validation

- Reproduced five scalar/array/null structured-content failures, missing resultType acceptance, and unsupported MRTR roots handling. Modern tool results now preserve every JSON shape, legacy object behavior remains explicit; every modern response requires complete/input_required discrimination.
- Added bounded MRTR exchange loop (64 retries, 64 input requests per response), exact opaque requestState echo, independent request IDs, per-method schema validation of callback responses, and original parameter snapshots. Old state/inputResponses are removed when not supplied by the next interim response.
- Shared semantic input_required validation between core and client through the tiny-stdio-mcp-server/protocol subpath. Client rejects malformed sampling histories and undeclared sampling tools before callbacks; genuine two-failure baseline and green tests recorded.
- Explicit onElicitationRequest callback supports form elicitation and declared URL capability without fetching/opening links. ClientCapabilities and sampling types widened for current spec. Optional modern identity uses ConnectResult; optional sampling stopReason matches official schema.
- Reproduced later callbacks executing after client.close while the first callback was pending; lifecycle checks now stop later callbacks/retries. Reproduced mutation of original arguments changing retry parameters; snapshot fixes it. Modern result test suite now 12 passing tests.
- Still required: callback cancellation context/ownership, modern subscription API and exact correlation, HTTP request-specific disconnect cancellation, cache metadata enforcement, modern removed-method behavior, negotiation timeout/fallback edge validation, and complete consumer audit.

### Core migration commit checkpoint

- Current combined client/core validation: 1439 tests across 44 files passed. Repository lint:types and all NodeNext/Bundler private/public type contracts passed. Selected client build closure six builds passed. MCP source ESLint passed with unused destructuring names corrected to the repository convention.
- Distribution audit reproduced upstream licensing notice loss in the inlined client bundle while the core emitted module retained it. Marked full notice as a legal comment; rebuilt and verified the client output retains the licensing-transition text.
- Commit core stdio migration independently; client and HTTP migration remain in the working tree. No remote delivery or release requested/proven. Full repository tests remain unresolved and the nine-hour minimum remains unmet.

### Client subscriptions in progress

- Confirmed three missing modern flows: automatic list-change listener subscriptions, explicit notification stream/graceful completion, and resource subscribe/unsubscribe translation. Implemented SubscriptionManager with acknowledgement-first state, exact subscription-ID correlation, accepted-filter checks, bounded entries and URI filters, explicit cancellation, and tagged graceful completion validation.
- Added listenNotifications(filter, options) returning McpSubscription with accepted notifications, ID, closed and cancel; modern list-change callbacks automatically open a subscription during connect. Historical legacy notifications keep their capability gating. Resource notifications require both URI membership and a live matching acknowledged subscription.
- Separate acknowledgement timeout; JsonRpcRequestOptions.timeoutMs:null disables the response timer for long-lived subscriptions while timeoutMs:0 retains its existing immediate-expiry semantics.
- Reproduced and fixed two resource races: stale handles after graceful completion and duplicate concurrent requests for the same URI. Pending resource registrations now coalesce; completion removes only the matching registration.
- Reproduced ignored caller abort and pre-aborted subscriptions still being sent. SubscriptionOptions.signal now cancels pending/active streams; resource unsubscribe aborts even before acknowledgement. Eight focused subscription tests pass, including re-open after pre-ack cancellation.
- Remaining important transport defect: modern HTTP cancellation still goes through notifications/cancelled POST rather than disconnecting its originating POST. Must implement per-request HTTP controller/body ownership before client migration can be considered ready.

### Subscription validation checkpoint

- Ninth focused regression found explicit listenNotifications resource filters were incorrectly gated by the legacy subscribe URI set. Modern delivery now relies on the matching acknowledged filter; legacy delivery retains the URI set.
- Client-wide check: 434 tests / 22 files passed. A legacy registration contract initially failed because the modern acknowledgement handler was installed for legacy clients; SubscriptionManager now initializes only after modern negotiation succeeds.
- Selected six-build client closure and MCP client ESLint were started after the final source changes; preserve/poll live handles rather than restarting them. Modern HTTP request-specific cancellation remains the next primary implementation task.

- Final client subscription build completed successfully (six-build closure). Final client-wide ESLint completed successfully. An earlier lint run found a prefer-const issue in the acknowledgement timer; corrected without changing timeout behavior, with a focused manager lint handle retained for terminal verification.

### Modern HTTP cancellation and negotiation errors

- Confirmed three originating-POST cancellation failures before headers and during JSON/SSE body reads. Modern request controllers now remain owned through body completion; notifications/cancelled are handled locally by aborting only the matching POST, never posted to a modern HTTP server.
- Reader abort listeners cancel retained JSON/error/SSE bodies and check cancellation before forwarding. Transport disposal aborts owned modern request controllers even after fetch headers resolve; late noncooperative fetch responses are canceled rather than forwarded.
- Five focused HTTP cancellation cases pass, including streaming HTTP error bodies and late response bodies. Legacy request lifecycle, response reading, modern cancellation and subscriptions: 44 tests passed at intermediate checkpoint.
- Confirmed six modern negotiation failures for recognized -32020/-32021/-32022 HTTP errors with absent/null JSON-RPC IDs. Normalize these error-only envelopes using originating HTTP request context while preserving error/data; never treat recognized modern errors as legacy fallback. Thirteen negotiation tests pass.
- Current complete client suite: 447 tests / 24 files passed; selected six-build client closure and focused client ESLint passed. Separate integer error-code regression fix staged/committing atomically; modern migration remains separate.
- Follow-up required: strict modern HTTP originating response/notification correlation, request/callback ownership bounds, modern callback signal context, retired RPC APIs, discovery/header cache invalidation, unconsumed OAuth bodies, and consumer/harness coverage.

### HTTP correlation and SSE framing checkpoint

- Confirmed three provenance failures: a successful originating POST could complete a sibling ID; modern SSE server requests invoked client callbacks; and subscription notifications tagged for another stream were delivered. HttpResponseMessages now enforces originating response ID, modern request rejection, subscription-ID/ack ordering, and originating progress-token checks before forwarding.
- Rechecked the provenance regressions with response timers removed from their success criteria: disabling context validation gives three concrete failures; restoring it passes. This avoids treating timeout errors as proof of correct correlation.
- Reader releases on final modern SSE response, including streams a server leaves open. Empty JSON/SSE bodies and truncated SSE streams now reject promptly rather than leave pending requests until timeout; three concrete failing cases and six green combined provenance/incomplete-body tests.
- Six SSE framing defects reproduced against the official WHATWG event-stream specification: LF/CR/CRLF boundaries, incomplete EOF dispatch and reconnect cursor advancement. Atomic parser fix committed locally as 70d0720b1. Full client checkpoint before incomplete-body changes: 456 tests / 26 files passed, six-build closure and focused lint passed.
- Consumer audit located an unresolved Toolcraft mismatch: createProxyCommand explicitly rejects non-object output schemas and public result types use ObjectSchema. Modern specification allows any JSON output root. Reproduce through maintained memfs proxy tests before widening DSL/MCP conversion.
- Markdown-reader scripts/smoke-test.ts is a scripted QA flow and must become a Markdown agent-executed plan under docs/plans, per repository instructions. Inspect its maintained test/script references before conversion.

### Toolcraft output-root checkpoint

- Local commits 70a462713 and 7271be8fd fix declared-output error classification and support modern scalar/array command and proxy schemas with legacy text conversion. Focused tests: 206 Toolcraft cases and nine core structured-content cases pass. Toolcraft lint and selected workspace build pass.
- Maintained Toolcraft package suite: 7557 passed, 51 failed. Failures include localhost EPERM, modern result metadata absent from historical expectations, and opaque default functions rejected by descriptor structuredClone. Focused sandbox-compatible rerun confirms these consumer failures; resolve them rather than treating them as pre-existing.
- Automatic approval review rejected the elevated maintained Toolcraft suite because localhost binding escalation is disallowed by the current policy. Do not bypass. HTTP integration checks remain pending approval; continue unaffected tests.
- No push or release requested. Nine-hour goal remains active and minimum duration is unmet.

### Consumer, schema and cancellation checkpoint

- Reproduced opaque defaults causing descriptor cloning errors; omit non-JSON wire defaults while preserving canonical handler defaults. 376 default/isolation checks pass. Local commit attempted and rejected by automatic approval review because current policy disallows elevated Git access; changes remain reviewable in the worktree.
- Modern runtime/approval/proxy expectations now include complete result type and exact server identity. Proxy checks distinguish upstream and wrapper identity. Scalar synchronous mappers now compile, with the asynchronous negative contract retained; 126 focused mapper/runtime/approval checks pass.
- Ordinary handler signal propagation and cancellation during service resolution: two genuine regressions reproduced and fixed. Cancellation while approval is pending and before opening approval: two regressions reproduced and fixed. Combined latest cancellation/runtime/gate suite passes 30 tests.
- Standard nullable schema descriptors replace the OpenAPI nullable extension with type arrays including null. Seven standard-interpretation regressions reproduced. All 2573 schema tests pass, including upstream conformance cases; selected consumer build and schema lint/types pass. Independent strict Ajv 2020 validation verifies generated nullable string descriptors. Exact consumer schema expectations updated and all 93 Toolcraft core tests pass.
- Markdown-reader package: 53 tests pass, coverage gate passes. Modern and legacy live stdio reads and clean stdin EOF exits verified against rebuilt nullable descriptors. Root CLI QA remains incomplete due sandbox tsx IPC and missing agent-code-review dist artifact.
- Scripted Markdown-reader and terminal-pilot-mcp QA converted to agent-executed plans in docs/plans. Terminal-pilot package smoke scripts removed from parsed package config; package QA execution pending.
- Maintained Toolcraft package rerun: 7577 pass, 37 failures (35 localhost EPERM plus two nullable expectations now fixed in the focused consumer rerun). Do not count restricted HTTP cases as passes. No release or remote delivery.
- Modern stdio message-layer request prohibition: registered roots handler invocation reproduced when receiving unsolicited server request; added protocol-level rejection before callback dispatch. Latest focused validation pending terminal result.

### Exchange and HTTP response bounds checkpoint

- Modern stdio request prohibition passes the registered-callback regression; full latest client suite passes 470 tests / 27 files.
- Client maxConcurrentRequests defaults to 128 and bounds full MRTR exchanges. Caller abort and disposal cancel callback waits promptly, propagate a callback signal, reject pending round requests and release capacity. Disposal leaves caller signals unchanged. Exported McpRequestContext preserves existing one-argument callbacks while exposing context to roots, sampling and elicitation.
- HTTP maxResponseBytes defaults to 16 MiB and bounds JSON bodies and full SSE frames separately from queue buffering. Oversized acknowledgements and modern/legacy tool results are rejected before writes. Zero queue limits retain immediate-drain behavior. CLI and Toolcraft configuration forwarding implemented and tested.
- Full HTTP suite passes 439 tests / 21 files after explicitly selecting legacy for historical session/DELETE/GET tests; other default-modern integration tests remain modern.
- Null-only type/const/enum precision regressions reproduced and fixed via null enum literals. Static null-enum compile contract passes; 27 converter checks and 17 CLI/SDK/MCP output-root parity checks pass. Full schema suite still passes 2573 checks. Selected Toolcraft closure build and package lint pass.
- HTTP help rendered and visually inspected using the maintained screenshot renderer invoked with Node's tsx loader to avoid IPC. The required npm screenshot-poe-code invocation remains sandbox-restricted; evidence and artifact paths are in the capacity plan.
- Next audits: legacy incoming callback signals/duplicate IDs/admission; oversized legacy notification history and replay; JSON Schema object/array constant and enum fallback precision; OAuth metadata/body/caching/store robustness; harness consumers; complete terminal-pilot Markdown QA; unresolved broad root test/build gates and authorized README rows. Nine-hour minimum remains unmet and active; no push.

## Callback admission and notification history checkpoint

Incoming callback admission, duplicate IDs, cancellation ownership and disposal regressions pass. Full client suite: 473 tests / 28 files. HTTP oversized notification retention regression and full server suite: 440 tests / 22 files. Combined scope lint passed; selected client build closure passed.

### JSON, OAuth and package artifact checkpoint

- JSON const/enum constraints preserved for object/array literals with structural equality; nullable wire schemas agree with runtime validation. Schema suite: 2,576 passed. Converter/CLI/SDK/MCP/dynamic preset and default isolation matrix: 364 passed. Combined proxy/schema/cancellation suite: 73 passed. Toolcraft selected build and scope lint/types pass at their checkpoints; latest changes have a final lint running.
- Outgoing request values are validated before snapshots/writes; invalid callback results become internal JSON-RPC errors. Full client suite before OAuth changes: 486 tests / 29 files passed.
- Oversized notification history and stream admission regression passes at maxStreamsPerSession=1 after repairing the in-memory response destruction lifecycle. Removed a conditional skip around a required statically imported client. Full HTTP suite: 440 passed / 22 files with no skips.
- Reproduced and fixed HTTP lookalike loopback DNS acceptance and IPv6 loopback rejection in discovery and provider. Live metadata/issuer credentials/fragments rejected consistently. OAuth metadata errors cancel their bodies; successful metadata reads are bounded to one MiB and streamed byte-limit cancellation/release passes.
- Terminal-pilot artifact pack/build/discovery/list/safe-call/EOF checks pass against local dependencies. Fresh installation unavailable due npm registry DNS failure; usable CLI help currently absent. Upstream title/annotation preservation regression prepared but unverified.
- Full maintained npm test rerun is active; observed current safe-python codec/Unicode failures remain under investigation. No remote delivery or release; nine-hour goal active and unmet.


## Continued verification checkpoint

- Mandatory modern discovery/cache result metadata is validated before client state or results are exposed; invalid server hints are rejected instead of silently defaulted. Corrected a stale request-capacity response fixture.
- Rebuilt the tiny-mcp-client dependency closure; clean-process source import and both spawned typed-output workflows pass. Spawned workflow fixtures now use inline Node source instead of writing temporary files.
- Harness loader replay now explicitly covers modern 2026-07-28 discovery and legacy 2025-11-25 fallback; both pass and repeated replay does not reconnect or repeat completed tool calls.
- Shared strict JSON safety and bounded HTTP body readers live in their owning schema/OAuth packages. Token and registration object responses now enforce a one-MiB byte limit and strict UTF-8; three red regressions and eight maintained token checks pass.
- Full Toolcraft rerun and repository-wide gate remain active. Repository-wide codec/harness timeouts remain unresolved; no overall success claim. Nine-hour minimum remains unmet and goal stays active.


## Authoritative broad gate result and subsequent fixes

The repository-wide npm test process finished with exit 1: 60 failed files, 2,191 passed files, 384 failed tests, 117,268 passed tests, 35 skipped tests, and one unhandled loopback EPERM. Runtime was 2,763 seconds. Many files/code were changed while this run was active, so this result is not final-state verification. It cannot be reported as an overall pass.

Subsequent current-source verification: full stdio suite 1,019 pass; schema suite 2,585 pass; native converter and SDK/CLI/modern-MCP parity 44 pass; authorization-server suite 22 pass; terminal-pilot four tool-surface checks pass; managed SafeJS suite 23 pass; harness replay-equivalence seven focused tests pass. Exhaustive coverage-demo replay timed out in isolation and is now preserved as Markdown QA with a small deterministic unit scenario. Full-fixture QA remains pending. Spawn argument holes/accessors were reproduced and rejected without invoking accessors.

The broad test handle is terminal, so rebuilding the selected Toolcraft workspace closure now is safe. Consumer export/type/lint and final artifact checks remain pending. No overall production-readiness or nine-hour-completion claim is made.

Selected Toolcraft build closure finished successfully (19 builds derived from current declarations). Rebuilt consumer type check passes. The complete maintained Toolcraft suite now passes all 7,643 tests in 115 files. Current-source OAuth suite passes all 124 tests after token/registration deadline, redirect, byte-limit, UTF-8, and ownership hardening. SafeJS managed HTTP coverage explicitly includes modern discovery and scalar structured results; all 25 managed cases pass. Full scope lint remains active, and final runtime/QA/artifact verification remains pending.

Adhoc native CLI screenshot captured and inspected a missing field label; four red maintained presentation cases led to qualified native JSON value error formatting. All 103 presentation/JSON/native parity cases pass. Memory MCP search limits now declare non-negative integer validation before handle execution; nine MCP helper cases pass and the maintained memory suite is running. Bounded HTTP helper tests have moved to mcp-oauth and all eleven pass. Rebuild is active for post-fix CLI screenshots; scope lint is active.
