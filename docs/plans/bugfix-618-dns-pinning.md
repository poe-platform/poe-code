# Issue 618: enforce private-address policy at connection admission

Author: kamilio. Status: implementation and fresh TDD in progress.

## Validated gap and scope

The current origin authorizer checks only URL hostnames. Curl passes no resolved
address policy into either shipped transport, and Node resolves at connection
time without checking the chosen address. The existing contract explicitly
documents that gap. Earlier bounded controls are historical evidence, not a
fresh runtime qualification of this candidate. Workers must record new failing
controls before implementation; no real cloud metadata access is required.

The fix must strengthen the existing `denyPrivateNetworks: true` configuration,
not require a second opt-in that leaves the reported path unchanged. Omitted
and false retain their existing behavior. The existing selected address ranges
remain the policy; this is not an expansion to every non-global address.

## Contract and implementation

- `NetworkAuthorization.requirePrivateNetworkDeny?: () => void` carries a
  monotonic per-hop requirement through authorization wrappers that forward
  the request. The origin helper snapshots its configured option and invokes
  this callback when protection is required.
- `HttpRequest.denyPrivateNetworks?: true` carries the accepted requirement.
  `HttpTransport.supportsPrivateNetworkDeny?: true` is a trusted assertion of
  actual enforcement, not a label that makes an arbitrary transport safe.
- Curl refuses a required policy on an unsupported transport before dispatch
  or upload admission. Every redirect and retry repeats authorization.
- The Node transport resolves and validates one candidate, rejects the existing
  private ranges, and uses only that pinned address for connection. Literal IPs
  receive the same checks. There is no second lookup or unchecked failover.
- `NodeHttpTransportOptions.resolveAddress` optionally injects the resolver;
  it receives the hostname and effective signal and returns address/family.
  The URL, Host and port retain their existing meanings. TLS identity remains
  the original hostname or IP even with a custom Host header; CA validation
  remains enabled. Cleanup is registered before DNS admission, with late
  completion observed and no socket or upload admission after cancellation.
- Generic Fetch cannot enforce a socket address pin. It does not advertise
  support and rejects flagged direct requests before body/Request construction.
  Previously successful true-option Fetch requests intentionally become refusals.

## Ownership and checks

Policy owner: types, authorizer, curl, shared classifier and policy integration
tests. Node owner: Node transport and DNS/TLS tests. Fetch owner: Fetch transport
and its tests, followed by independent read-only review. Root owns this plan,
the private-address contract, test registration, integration, Git and delivery.
No README addition is authorized.

Required RED/GREEN controls cover the existing true option with no additional
opt-in, wrapped authorizers, private answers and literals, single pinned lookup,
redirect/retry re-resolution, unsupported transports, Fetch body non-admission,
Host/TLS identity, malformed resolver answers, falsey cancellation, late DNS
completion and unchanged omitted/false behavior. Existing literal and translation
prefix boundaries remain exact. Use bounded mocks/Memory, not external services.

After workers freeze: review, normal build, maintained type/consumer checks,
network and integration tests, root lint, appropriate full unit coverage, and
an inspected built-package CLI screenshot. Pull with rebase, verify remote main
after normal push, close only the validated issue, then monitor publication
separately while continuing the remaining kamilio issues.

## Worker checkpoints

Policy wiring is frozen after fresh RED: eight of twelve new policy cases failed,
and twenty of ninety revised integration cases failed. GREEN passed thirteen
policy cases, ninety integration cases and 133 unchanged literal controls.
The successful mock transport actually checks its selected numeric destination;
these controls are not evidence of native connection pinning. The Node owner
still owes the composed Shell/curl-to-actual-Node reproduction and qualification.

Fetch is frozen after twelve passed/four failed in fresh RED, followed by all
sixteen passing. Both public network and browser entries reject flagged requests
before Request/stream/header construction, body access, iterator acquisition or
fetch. Pre-abort reason identity, unsupported-protocol precedence and omitted or
runtime-false legacy requests remain covered. No support capability is advertised.

These are worker-scoped results, not a completed integrated build, typecheck,
lint, unit gate, deployment or release. Root retains the original failed runs
and intentional Fetch compatibility change rather than counting them as passes.

Independent review found no concrete policy/Node source bypass or new lifecycle
blocker; that source review is not independent socket/TLS execution evidence.
Five bounded probes clarified the non-admission claim: all refused with status 7
and zero transport calls, but existing `-G` query construction and `-w @format`
preparation can consume VFS/stdin inputs before authorization. Ordinary `-d @file`
and `-T -` did not acquire their inputs. The contract therefore distinguishes
request-body upload iteration from preauthorization input preparation. No
unrelated body-pipeline change is included.

Node is frozen after DNS RED with 27 failed/six passed and TLS RED with three
failed/three passed. Final isolated GREEN passed 83 controls: 42 DNS, six TLS
and 35 existing HTTP/safety controls. This includes default builtin resolver
mocking (`lookup` with `all:false`), composed Shell/curl with the existing true
option, candidate snapshots, pinning, literal boundaries and cancellation races.
TLS uses existing loopback certificates with an explicitly test-remapped dial
address to reject mismatched original DNS/IPv4/IPv6 identities despite Host
overrides. It is not an external TLS/DNS deployment test.

Native TLS RED exposed Node's rejection of the previously array-valued Host
header. Protected requests now pass a single explicit Host value as a scalar;
unprotected behavior and duplicate-Host handling are not silently broadened.
This makes the protected Host-override identity checks exercise TLS rather than
stop at header argument rejection. Root still owns integrated qualification.

The first integrated normal build passed. Maintained typechecking then found
three new Fetch test accessors without explicit return statements (TS2378).
Root returned their existing `assert.fail` calls, retaining the exact throws,
messages and non-admission assertions. The original failed typecheck is retained;
the worker Fetch hash describes its pre-correction handoff, not this final file.

The corrected maintained typecheck passed all 26 current consumer groups, and
the complete current network cohort passed 560/560 with no skips. A built public
package probe asserted exact Shell output/status for private Node DNS refusal,
unsupported protected Fetch refusal, and unchanged explicit-false Fetch success.
Its child exit status was checked independently before capture, and the PNG was
visually inspected. Only the explicit-false mock Fetch was dispatched; the Node
resolver returned a bounded private answer without opening a private connection.

Final qualification uses the complete maintained virtual-bash unit task plus
normal workspace build, root lint and public-consumer types. Product changes are
confined to this workspace's network implementation; shared infrastructure and
other workspace source are unchanged by this issue. This package-scoped gate is
not represented as a fresh repository-wide `npm test` run.
