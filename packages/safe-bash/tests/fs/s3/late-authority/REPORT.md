# S3 late explicit authority: denial bypass fixed

Date: August 27, 2026. Scope: S3 source/backend tests only. Contract `5076b32`
and core `0bee8e7` remain authoritative and unchanged. The Memory owner separately
committed its callback fix as `2926891`; no Memory, wrapper, WebDAV, core,
contract, independent fixture or original acceptance input is changed here.

## Reproduced failure

The frozen S3 filesystem SHA256 was exactly
`8c98a7738aed477a238084624b4e374d4cdf1575708684d0991869427288a120`.
Its registered private terminal authority did not inspect a postconstruction
`compareEntry` replacement. Both source-side and target-side late callbacks were
ignored. In the buffered and streamed own reproductions, EACCES comparison and
copy each called the callback zero times, returned distinct/success, and changed
target `[33,0,34]` to source `[0,255,128,17,10]`. Source bytes survived. GET/PUT
requests occurred despite the denial. The mixed Memory target reproduced this
same overwrite. This is an actual denial bypass, not just an unexpected relation.

The unchanged independent late-S3 holdout failed 0/1 before the patch. Its frozen
`explicit-late-confirmed` observation likewise reports distinct, zero comparison
and copy callbacks, and target `c291cmNlIHN1cnZpdmVzAO+/vQ==` (source bytes).
After the fix it reports EACCES for both operations, one callback per operation,
and target `aW5kZXBlbmRlbnQgdGFyZ2V0IHN1cnZpdmVz` (original target bytes).

`before.json` seals the old sources, initial own fixture, raw observations,
independent fixture, commands, source manifest and failures: own 2/33 and
independent 0/1. It is never rewritten.

## Narrow source change

The enrolled S3 authority saves the true original base comparison reference.
Each negotiation checks the current explicit method on both enrolled S3 operands,
once per filesystem, including when the same function belongs to two operands.
Callbacks receive the actual receiver, followed paths, peer and signal. Errors
and cancellation propagate; invalid/conflicting results fail EIO before effects.
An explicit unknown or removed method does not fall through to the built-in S3
storage inference. Constructor-time explicit methods use this same dispatch.

Complete known identity tuples still win before any callbacks. The common helper
still suppresses recursive negotiation; a recursively forwarding callback cannot
authorize an overwrite. These tests do not publish fake S3 inode identities: the
known-tuple test supplies synthetic resolved views directly to the existing helper
solely to verify its unchanged precedence. Unchanged qualified providers still
copy existing distinct entries. Original full provider/adapter operation binding,
metadata provenance and `getOwnedS3Entry(view)` signature remain unchanged.

## Evidence and validation

All captures include core `0bee8e7`, whose filesystem source hash remains
`393ea36b78c2cc142633c0eb631bf4d316767b3992c0d5f0724135ca4f01403a`.
The baseline snapshot HEAD is `292689149ae75ff7fa8a2859d65b3a91c265681f`;
the final snapshot HEAD is `bd2cacb3a20403302fd0a49441932d5522793e56` plus the
recorded owned patch. Every capture has zero changed source inputs during its
commands. Concurrent HEAD advancement is not represented as a clean-HEAD test.

| Source | Before SHA256 | Final SHA256 |
| --- | --- | --- |
| `src/fs/s3/filesystem.ts` | `8c98a7738aed477a238084624b4e374d4cdf1575708684d0991869427288a120` | `97f91913c3b2a9916218776d286eeaf25928d3aebbe3df60f0bf2d24d1635f6f` |
| `src/fs/s3/authority.ts` | `0e12d26f2882f31cb2f33476c0bd18aed250404f8e3624d67aff1c3e5e7853a4` | `102a8ada61020ff65d3617cdd60fca350bff3e99f287fc0696ece04aac32b229` |

`after.json` preserves the first postpatch run: own 25/33, independent late 1/1,
existing authority 42/42, independent S3 binding 13/13, original source-loss 1/1,
and scoped types exit2. Six new assertions incorrectly expected the raw FsError
object rather than Mount's contextual error preserving it as cause. Two expected
a `putObjectStream` trace name, but Mock records both upload paths as `putObject`.
Corrections assert exact EACCES/cause/syscall/source/destination and actual Mock
upload-body evidence (stream trace empty body; buffered trace source bytes).
Types additionally required narrowing returned bodies and the known original
method descriptor. No acceptance expectation or independent fixture changed;
the original and corrected own fixture texts are both in the captures.

`final.json` records:

| Scoped command cohort | Result |
| --- | --- |
| New `tests/fs/s3/late-authority.test.ts` | 33/33 |
| Existing S3 comparison + adapter override tests | 42/42 |
| Unchanged independent S3 adapter-binding holdout | 13/13 |
| Independent late-S3 denial alone (included in those 13) | 1/1 |
| Unchanged original S3 custom-client source-loss regression | 1/1 |
| Strict S3 source and all S3 backend-test TypeScript | exit0 |

All final test cohorts have zero failures, cancellations, skips and TODOs. The
new cases cover both directions and buffered/streamed same/distinct/unknown,
denial/invalid/cancellation; mixed Memory denial; conflict; peer cancellation;
shared callback deduplication; same-operand recursion; known identity precedence;
late prototype replacement/removal; and an unchanged qualified positive copy.
Failure paths assert exact source and target preservation, with no content or
mutation requests in the parameterized S3 cases. Comparison itself performs only
HEAD/LIST metadata operations. Successful copy checks actual provider bytes and
namespace contents, rather than counting refusal as a positive workflow.

The independent adapter-binding fixture remains SHA256
`f90f1da067ec03ed467aeaa39d50114d9e03a4e13da8fb5548a2f49e1fdac712` and original
remote-comparison fixture remains
`039cce5f0fc93b4e2e96a61448ac104e20aa5aaf767db4c33c53263598cb7660` throughout.
Run `node tests/fs/s3/late-authority/validate.mjs replay-unique-label` for a fresh
capture; it refuses to overwrite existing evidence. `SHA256SUMS` seals these
artifacts, final owned source/test/docs and the replay script.

## Limits and ownership

This narrow followup does not rerun the entire backend, policy86, conformance or
original38-positive cohorts. Earlier `37edad8` results remain historical, not
fresh results of this patch. No policy fixture, `d25cb3f` permission delta, frozen
old RED history or independent evidence is modified. No arbitrary opaque client
qualification, authority registry, broad trust flag, snapshot atomicity, ABA or
universal real-S3 interoperability claim is introduced. Independent original
positive verification remains with its assigned owner. Only explicit owned S3
paths are included in the atomic commit; the shared descriptor consumer handoff
is updated separately at `/tmp/safe-bash-s3-authority-handoff.txt`.
