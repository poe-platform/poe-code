# Independent real WebDAV checkpoint — August 27, 2026 UTC

Production and author fixtures were read-only. This review independently reruns
the real-service author evidence and adds a hidden public-package negative batch.
It accepts two scoped source changes, verifies useful legacy compatibility, and
reports one remaining grant-validation defect. It is not all-provider acceptance.

## Frozen source and package

- Product snapshot: `e8acecc3a843642ca83127d43d8c65ea46c2c0e4`.
- Author fixture checkpoint: `1c745c3a633c32a8e9d87dacfdf33fcadc00caf2`.
- WebDAV source SHA256:
  `8c280010a9de5f915ebb72be504d79f2a149e95064752c3a4b4a07cd425efd54`,
  identical to final author source `93c009d`.
- Product source/config archive SHA256:
  `75f6de8b5048ca67796fba38ff8416a72c6ec6fb276e03997b148123b43e4dda`.
- Both independently built service consumers use package tarball SHA256:
  `cf6f97a2ac982f1a50de504f71cf1cce58df19badadc3e2cd755a8256c405bc4`.
- Final capture: `2026-08-27T06:25:38.877Z–06:26:30.695Z`.
- Node22.22.2, Darwin arm64; cached TypeScript5.9.3/tsx4.23.12.
  Package runtime dependencies remain empty.

The product is a committed archive, not the dirty shared worktree. Its config
and root exports are not edited. Each provider builds ESM/declarations, packs
the library and strictly compiles root/subpath public TypeScript consumers.
Their ordinary Node execution imports the installed tarball, not repo source;
the extra consumer enforces this with a resolution guard and records actual URLs.
Build and strict scoped/consumer types pass. No global competing test suite runs.

## Source-change decisions

| Source change | Independent decision | Evidence boundary |
| --- | --- | --- |
| `4143efd` timestamp postcondition | Accepted for its stated fix |5 unchanged tests pass; real first-directory metadata update returns EAGAIN rather than false retained-time success; second initialized update still works |
| `93c009d` direct comparison authority | Accepted for its stated fix |23 unchanged tests,49 alias guards,15 Apache real direct guards and eight new before-effects authority cases pass |
| `0e69b39` absent-only legacy lockroot | Compatibility justified and positive paths verified, but grant validation remains incomplete |23 unchanged tests pass; Apache default COPY/MOVE work; three new contradictory-scope recipes reach destructive transfer |

No source fix was made by this reviewer. The scope-validation issue below is
routed for an assigned source author. These decisions do not certify arbitrary
physical aliases, callback truthfulness, provider transactions or all input XML.

## Unchanged author cohorts

The frozen validation command reruns **564/564 WebDAV**, **23/23 legacy LOCK**,
**23/23 direct authority**, **5/5 timestamps**, **49/49 historical alias guards**,
all zero failures/skips. The constructor suite passes14/14 separately but is
already represented in the564 denominator; it is not additional unique coverage.
Required49 fixtures retain their historical hashes. Strict scoped types and
full source/declaration build pass. The final service-only replay does not count
the omitted validation run as another pass; it uses this preserved same-source gate.

Every original real-service row name, kind and outcome matches the author's
final profile, checked programmatically. None was renamed or rebaselined.
Entries below are **pass/total**, not pass/fail; refusals are not positive support.

| Profile / original cohort | Positive | Guard | Refusal |
| --- | ---: | ---: | ---: |
| Apache raw |9/9|7/7|0/0|
| Apache public |16/17|14/14|2/2|
| Apache direct |2/2|15/15|0/0|
| WsgiDAV raw |3/9|3/7|0/0|
| WsgiDAV public |10/15|13/13|4/4|
| WsgiDAV direct |0/2|13/15|0/0|

Apache's one remaining original positive is the first directory timestamp
update, still EAGAIN. That is an interoperability gap, not a new refusal pass.
Default lock-based COPY/MOVE with actual configured native backing authority
both work; no substitution of opt-in ETag mode is used to claim default support.

WsgiDAV is **not a safe overwrite profile** in these observations:

- Its unquoted DAV:getetag and unframed Lock-Token are rejected at the adapter
  validator/token boundary. The five public positives remain failed, not waived.
- Raw stale destination-tagged conditions return204 and overwrite; raw MOVE
  also removes the source. This is a server conditional-enforcement defect.
- Two wrong-token guards preserve both entries but return423 rather than the
  original expected412. They remain failed rows, classified status disagreement,
  not falsely described as observed data loss.
- Correct-token raw transfers complete204 but remove the lock before UNLOCK,
  which returns409. Pre-UNLOCK lockdiscovery witnesses distinguish this from a
  simple transfer failure.
- The original alias-URL PUT bypasses the /dav lock with204, and late acquisition
  cleanup leaves a grant visible. Both original direct guards remain failed.

The review does not repair WsgiDAV headers, weaken its guards or bless raw
overwrite behavior. Error/refusal safety does not establish usable parity.

## New negative batch: one product defect

The final31 independently selected cases report **Apache28 pass/3 fail** and
**WsgiDAV29 pass/2 fail**, zero skips. These denominators remain separate from
the original matrices. They cover packed root/subpath identity, binary default
transfers, callback unknown/same/error/cancel before effects, real LOCK mutations,
changed source validators, auth/exclusive-create, preabort, in-flight GET and
LOCK-body cancellation, byte range/early close, quotas and timestamp postconditions.

Apache's three failures have one cause in
`src/fs/webdav/webdav.ts:858`: the validator checks that `DAV:exclusive` exists
but does not exclude a simultaneous recognized `DAV:shared` scope.

1. Exclusive then shared: COPY reaches204; target changes from `OLD` to the nine
   source bytes `[0,255,128,195,169,13,10,0,65]`.
2. Shared then exclusive: same observed COPY and target replacement.
3. Same contradictory scope on MOVE: MOVE reaches204, target has those bytes
   and the native source witness is ENOENT.

The test acquires a genuine Apache lock, changes only the scope XML, updates
Content-Length to describe those bytes and preserves the real token/status/URL.
It is a controlled malformed-server-response regression, **not a claim that
Apache emits contradictory scopes or that its actual granted lock was shared**.
The bug is acceptance of an ambiguous assertion followed by publication. There
is no claim of adversarial-provider confinement or demonstrated arbitrary data loss.

Requested minimal source follow-up: require exclusive scope without a recognized
shared sibling before invoking the transfer; preserve unknown-extension handling,
default valid Apache operations, typed failure, cancellation and finally-UNLOCK.
Do not reject every unfamiliar XML child or disable legacy missing-root support.
The unchanged valid-body positive and unknown-element control prevent deny-all
acceptance. No production source modification is authorized by this report itself.

WsgiDAV's two new failures are the default binary COPY/MOVE positives rejected
on its invalid token header. The deeper XML mutation guards there are **masked
by that earlier token rejection**; their passes do not validate its scope parser.
Own raw test cleanup can frame a known captured token for teardown, but production
never uses that repair. Teardown is recorded separately and is not a support pass.

## Primary protocol/source review

Fresh primary RFC2518/RFC4918 and tagged Apache/WsgiDAV source hashes/excerpts
are in `evidence/primary.json` (URLs included for reproducibility).

- RFC2518 sections8.10.1/9.5/12.1 bind a newly granted lock to the Request-URI
  and lack the later lockroot element. RFC4918 sections9.10.1/14.12 preserve
  request binding and make inclusion of lockroot SHOULD, supporting absent-only
  compatibility. Explicit empty/foreign/wrong roots are not absence.
- RFC4918 section14.13 defines exclusive and shared as alternative recognized
  scopes. Accepting both does not establish the promised exclusive grant.
- Sections10.5/15.6 retain coded-URL token and HTTP entity-tag requirements.
  Tagged WsgiDAV source confirms raw token/property emission; tagged Apache
  source confirms its legacy grant structure. Service wire witnesses remain
  authoritative for the tested installed binaries.
- RFC4918 section17 requires unfamiliar XML extensions to be ignored. DAV:read
  is not a defined competing lock type here. The early reviewer expectation
  that write+read must fail was an **oracle defect**, not a second product bug;
  final tests explicitly preserve valid write behavior with that unknown child.

## Fixture corrections and preserved history

`attempt1` never reached services: six reviewer TypeScript errors concerned
initializer inference, callback-mutated token narrowing and incorrect stream
option/iterator usage. Corrected only in the new owned harness.

`attempt2` had27 cases. Four Apache failures included fresh weak-validator setup,
mistaken collection of the `readBytes` generator and a timestamp setup unable to
reach the desired postcondition. WsgiDAV had the two known positive refusals plus
the collector error. XML mutations also kept the old Content-Length, so earlier
length rejection masked the intended scope check. Those apparent guard passes
are not evidence of correct scope validation.

`attempt3` corrected setup, collection and framing: Apache26/28 and WsgiDAV26/28.
Apache's two failures were mixed scope (real bug) and unknown read element (invalid
oracle). The final31 add scope-order/MOVE and LOCK-body-abort controls and classify
the unknown extension correctly. All earlier input files/results are retained;
no product change or original author oracle change accounts for these deltas.

## Service pinning, artifacts and cleanup

Apache is `/usr/sbin/httpd`2.4.66; binary SHA256
`17eab33df66fd97b9a176505d3b4d3357fd529820a7bab1d460a2092344b0871`
matches the author's pin. Actual module hashes and complete literal task-local
configuration are in `evidence/final/apache/apache-profile.json`. Both DAV URLs
map the same task-owned native root; FollowSymLinks is an explicit test profile,
not a sandbox guarantee. TLS uses only the task certificate/CA, never global flags.

WsgiDAV4.3.5/cheroot11.1.2 and all eleven official-PyPI wheel hashes are in the
preserved dependency lock. Temporary venv installation, pip check/list and
Python/OpenSSL/bootstrap details are in its commands record. The exact server.py
profile hash remains the author's `16188c6e6c8c24ae8c9dda1ee51a27003b116fd126d85e653bad09171bab1e35`.

Final Apache PID28902 exits0; WsgiDAV PID30123 exits on SIGTERM. Both cleanup
records and the outer removed tree were checked absent. No private repository,
global config, root manifest/tsconfig, main dependencies or other worker files
were modified. Retained `/tmp` evidence contains no live service or private key.

`evidence/CHECKPOINT.json` lists exact failed rows, witnesses and checks.
`evidence/ARTIFACTS.json` records captured and archived hashes. Large JSON evidence
is losslessly compacted (parsed deep equality checked); response body strings,
fixture XML and all assertions remain unchanged. Original author evidence remains
byte-for-byte untouched. Reproduction is in README.md. Atomic rename stays false;
rmdir, rollback, arbitrary-provider support and broad project acceptance remain open.
