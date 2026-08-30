# WebDAV streaming capability fix and breaking migration

August 30, 2026. Work only in a new isolated copy of published C source.
Public baseline: `poe-code@12.0.7`, gitHead
`a21b09b450739d2ccfc44a1a17770fd86785d7e4`.

## Authorized implementation boundary

Approved exact production patch paths:

- `packages/safe-fs/src/fs/webdav/webdav.ts`
- `packages/safe-fs/tests/webdav-stream-capability.test.ts` (new)
- `packages/safe-fs/README.md`
- `docs/plans/webdav-stream-capability-fix.md` (new)

One additional fixture-only path is included under the coordinator's explicit
authorization: `packages/safe-fs/tests/abort-signal-compatibility.test.ts`.
Its only changes are two `requestStreamSupport: true` option additions. The
faithful upload fixture drains the actual ReadableStream to completion and
asserts its uploaded bytes. The construction-failure fixture opts into reaching
the constructor failure under test; its existing exact-error and zero-transport
assertions remain unchanged. This second fixture does not claim its never-called
transport was independently certified. No adversarial assertion was removed.

No helper outside WebDAV is necessary. Safe-fs paths remain unchanged through
the SafeJS rename; no runtime, package manifest, export route, or registry change.
Read-only inspection of S3 shows a separate explicit transport and streaming
capability path. Its HTTP transport uses Node request machinery rather than this
Fetch ReadableStream path and does not advertise streaming PUT. No S3 change.

## Established red and root cause

The immutable transport receipt is `/tmp/webdav-browser-transport.Is3xsm`.
Eight Firefox page/worker HTTP1/HTTP2 wx/w cases mutate the server with the
23-byte text `[object ReadableStream]`, without consuming the source, before EIO.
Ordinary byte uploads work. Chromium HTTP2 streaming works; WebKit native Fetch
does not accept streaming uploads. All original 105 evidence hashes remain intact.

The current `WebDavFetch` contract is a required trusted `(url, init) => Promise<Response>`
function. It carries no stream capability declaration or native-transport identity.
`writeStream` constructs a ReadableStream, performs PUT, then checks whether the
source completed. That post-mutation check cannot prevent native coercion.

The Request constructor's duplex getter and implicit Content-Type behavior can
check current-realm native body support without consuming the caller's source or
sending any request. It cannot attest what another injected function does with
that body. Function source strings, names, user agents and versions are not a
valid substitute. Bound native Fetch is also a distinct function identity.

`transport-contract-probe.mjs` demonstrates the distinction against isolated
actual C source: native Node Request supports the stream, one injected function
faithfully consumes it, another writes its string conversion. Both satisfy the
same current function signature. No native network or production mutation is used
by that contract probe; its in-memory coercion assertion deliberately stays red.

## Approved transport contract

One optional trusted declaration on WebDAV options:
`requestStreamSupport: "native" | boolean`.

- Direct current-realm native Fetch: automatically run the native Request probe.
- Wrapper explicitly declaring `"native"`: host promises it delegates streaming
  to the current realm's native Fetch; run the same probe. This is a trusted
  statement, not function introspection or independent wrapper validation.
- Custom `true`: host explicitly asserts faithful ReadableStream handling by
  that injected transport. Native Request support is not treated as its proof.
- Custom `false`: reject streaming with ENOTSUP before source acquisition or I/O.
- Unknown/unannotated custom or bound transport: fail closed for streaming only.

The last case is an intentional compatibility tightening: existing faithful
unannotated custom streaming callers must declare support. Direct native Node18 Fetch stays
automatic; custom transports remain supported through the declaration; ordinary
byte operations remain available. The coordinator explicitly approved this
breaking change and the migration examples in the package README. A native
Request probe does not certify arbitrary injected transport code.

No generic capability registry, new dependency, Node/browser version branch,
global setter, polyfill, or silent buffering fallback is proposed. An explicit
custom declaration is a trusted host capability, not protection from dishonest
injected host code. The declaration is captured at construction. Recognized direct
Fetch is bound to its realm so browser Window/WorkerGlobalScope receiver checks
also succeed; explicit custom transports retain their existing invocation behavior.

## Implemented guard and proof gates

An already-aborted signal remains the primary cancellation error before probing
or source access. The synchronous gate establishes streaming
capability before `prepareWrite` and before any request. Current `prepareWrite`
only performs reads/stat probes, but placing the gate before it also prevents
future LOCK, MKCOL, temporary-resource, or PUT side effects from preceding denial.
The native probe creates only its own already-closed empty stream, reads the
duplex option through a getter, rejects implicit string Content-Type conversion,
and performs no network request. Unsupported capability rejects before subsequent
path/write preparation; supported writes retain their existing validation path.

TDD evidence: 22 of the initial 34 focused cases failed behaviorally before the
gate. An additional receiver regression failed before direct Fetch binding.
The final focused file contains 36 cases. Validation covers:

- Native probe coercion/unsupported behavior yields ENOTSUP without source
  iterator acquisition, next/return calls, transport calls, locks, mkdirs or PUT.
- Existing nonempty file remains byte-identical; new target is absent.
- Trusted custom positive/negative declarations are independent of native
  Request support; unknown wrappers are handled by the approved default policy.
- Invalid option, early abort, primary upload/source error, and iterator cleanup
  retain explicit class/code and cleanup precedence; no buffer fallback.
- Actual Node18.18.2/18.20.8/20/22/24 streaming and existing focused network/
  cleanup controls, without live-root readers or a root build.
- Installed candidate browser root/core graph and real loopback HTTP1/HTTP2
  matrices in Chromium/Firefox/WebKit, both page and module worker. Preserve the
  eight public-C reds before substituting candidate outputs. Native and wrapped
  native denial must occur before every mutation, not merely before PUT.
- Genuine Chromium HTTP2 streaming stays successful. Custom transport controls
  prove declaration behavior without pretending a Request probe validates them.
- Re-run previous green transport, confinement, identity, wrapper, cancellation
  and bounded tree stress controls; retain all request/effect journals.

The five Node versions each pass 105 focused tests, plus 10 installed-candidate
real HTTP/1.1 cases and canonical root/core/node identity checks. Test workers use
isolated processes consistently: Node18.18.2's threaded Vitest run reported
passing assertions but stalled at shutdown; its raw timeout is retained rather
than claimed green. No production Node version branch was added.

The installed candidate passes 198 capability cases in Chromium 149.0.7827.55,
Firefox 150.0.2 and WebKit 26.4, page and module worker. Native unsupported uploads
have zero source acquisition and zero DAV requests, preserve a nonempty existing
file, and leave new targets absent. Both unknown custom and unknown bound
transports fail closed. An explicit custom test transport consumes at most 64
bytes and sends them over real HTTP; this proves the trusted declaration is
independent of native stream support, not a library buffering fallback.

All prior transport controls are rerun: 156 asserted main cases, 12 separately
identified streaming observations, and 36 repeated stress scenarios. Both stress
schedules total 1,242 adapter calls over 54 seeded runs with concurrency 1/2/3.
Native Firefox/WebKit uploads now reject with ENOTSUP before I/O; genuine Chromium
HTTP/2 and Node HTTP/1.1 streaming remain successful. Chromium HTTP/1 streaming
still rejects at the transport layer; no universal upload support is claimed.

The candidate is packed from the real published C payload plus the rebuilt
canonical Node six-entry and browser two-entry groups using unchanged release
helpers and their cleanup/reachability guarantees. It is not a main/root build.
The groups use only captured immutable C source and captured tooling dependencies.
Only declarations are emitted by tsc for safe-fs; no second FS JavaScript runtime
is packed. Installed strict NodeNext/Bundler Node/browser profiles verify the
actual new option and private conditional policy types with no source aliases.
Exact existing browser denial routes remain denied. Package policy positive and
11 strict negative controls preserve export, graph, closure and dependency checks.

The evidence directory is `/tmp/webdav-stream-capability-fix.A0Vr6J`. It contains
baseline hashes, exact commands, raw red/green logs, actual request journals,
screenshots, candidate pack/type receipts, and a normal five-path patch. All five
paths are unchanged by the canonical SafeJS rename, so the rename-compatible
patch has the same paths and content. Rebase by hunks onto the coordinator's
current candidate; never replace files wholesale or reuse this old-baseline
candidate tarball as the production release.

## Breaking release and owner relay

Suggested release commit subject:
`fix(safe-fs)!: reject undeclared WebDAV request-stream transports`

BREAKING CHANGE: WebDAV writeStream now rejects unannotated custom or bound
Fetch transports before source acquisition or I/O. Declare requestStreamSupport
as "native" for faithful current-realm native delegation, true for a trusted
custom stream-preserving transport, or false to disable uploads. Direct
current-realm Fetch is probed automatically. Byte writes remain available.

Relay this exact option contract and minimal fixture migrations to Lorentz via
the root coordinator for his separately owned canonical port tests. Relay the
bounded patch and receipts to Feynman for the next serialized breaking release
after the active gate. Release version is the coordinator's decision; the local
tarball retains the baseline manifest version and is explicitly unpublished.
No live source, root manifest, lockfile, Git index/ref, or existing frozen evidence
is changed. No whole-SDK or deployed WebDAV certification follows from this fix.

## Verified 13.0.0 publication — August 30, 2026

The five-path breaking change was integrated by hunks onto current main, preserving
the canonical rename, named-policy and typed-error fixes and the independent
host-record prototype replay change `9b344cca528d0715917b3a4e84247b0af0258eb4`.
The owner-local candidate evidence above remains historical; it was not substituted
for the fresh root candidate or the published registry artifact.

- Commit and actual registry gitHead: `1b180668e29f43421ab2b89210a17ab6eab8c06e`.
- Release workflow: `33306648081`, success; exact checkout matches that commit.
- Actual published version: `poe-code@13.0.0`, selected by the existing breaking
  release policy, not locally published or assumed in advance.
- Root candidate: 26,849 tests pass, 41 unchanged skips; build, lint, types,
  all 17 package rules, workflow lint, signatures, smoke, pack and ordinary hooks
  pass. One production file changes; no dependency or lockfile change.
- Fresh installed public checks: 152 WebDAV/policy/error cases on each of Node
  18.18.2, 18.20.8, 20.19.2, 20.20.0, 22.22.2 and 24.14.0, plus public SDK/CLI,
  recovery, canonical alias identity and strict Node/browser type boundaries.
  Separate Node type generations 18/20/22/24 pass. All 141 canonical JavaScript
  artifacts and 1,492 declarations match the candidate; 51 are FS declarations.
- Registry SHA-256: `4218eb12cd90a32c75731c106b97ae0b1e635c095dcc1430b15b397841f79f64`.
- Registry SHA-1: `de17f627fb29478a3b3a16d4b6dcde40078e95ca`.
- Registry integrity: `sha512-+7s4lR/WMNqHD8GvmmYuoZpIRGyH/Tkdarp4LM8ScI7XNsg8vNkChF4xL2LSUqGIfZ0tQ5u2KjH9GFjhaD+grQ==`.

The independent prepared runner downloaded this exact version and verified all
three digests and gitHead. Its actual registry tests pass 50 native Node HTTP/1
controls on 18.18.2, 18.20.8, 20.20.0, 22.22.2 and 24.14.0. Chromium 149.0.7827.55,
Firefox 150.0.2 and Playwright WebKit 26.4 pass in both pages and module workers:
198 capability assertions, 156 transport assertions and 36 stress scenarios
(390 total), plus 12 separately counted observations. The journals verify 134
zero-source/no-I/O cases and 1,242 stress operations. All eight original Firefox
coercion regressions now reject with `ENOTSUP` before source acquisition or any
DAV request, preserving existing nonempty targets and leaving new targets absent.

Native Firefox/WebKit streaming is safely unsupported, not made functional.
Genuine Chromium HTTP/2 streaming passes in the exercised deployment; native
Chromium HTTP/1 retains its transport limitation. Trusted custom transports
remain explicit host assertions, not protection against dishonest code. Ordinary
byte writes and the Node >=18.18 baseline remain supported. No browser SDK,
guest codec, safe-bash migration or full language completion is claimed.

Authoritative coordinator receipt:
`/tmp/release-webdav-published.9XRakw/artifacts/final-receipt.json`.
Independent published transport receipt:
`/tmp/webdav-published-verification.yWqwIE/RECEIPT.json`.
Regression/digest audit: `/tmp/webdav13-public-audit.z50A2E/HANDOFF.md`.
Original checkout HEAD/index, all four terminal fonts and the `CLAUDE.md` symlink
remain unchanged. Initial failures and frozen evidence are retained. The ten
candidate-development advisories and 34 default-branch GitHub alerts are separate
scopes, not a security-zero claim; no unrelated dependency upgrade was made.

This postrelease reconciliation changes documentation only. Canonical adapter
coverage must land in a separate test commit before private safe-bash retirement;
that migration requires its own final candidate approval and gates.
