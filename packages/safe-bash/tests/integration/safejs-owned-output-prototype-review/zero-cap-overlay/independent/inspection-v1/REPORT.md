# Independent zero-cap inspection — 2026-08-27

Reviewer: **Codex Independent Leaf Verifier**, thread
`01a043dd-cfc3-7f93-8f3b-70e2d7b1d2a4`; not the overlay author. This is a
SHA-attested inspection/reconstruction, not a personal cryptographic signature.

**Source derivation, independent public rebuild and fixture semantics qualify.
Unrestricted exact-freeze replay admission is WITHHELD pending the narrow
first-nonpass scope decision I01 below. No actual replay was released or run.**

## Authenticated inputs and independent reconstruction

- Independent pre-author criteria: `ee8bc35906e363566a22e26b8286e5bcac7f1d2f`;
  all eight existing prep files remain unchanged.
- Author freeze: `a61e63bc46e8389e59c0d8fdc1d424003f62c769`; FREEZE.json SHA-256
  `21630afdf43a4538faf25bf00c372a6b0c1e7ab632e30bdc1880e086fa14eedf`.
  All 88 author files, including the seal, and all 77 referenced Git blobs were
  authenticated. Review used those Git bytes in a new regular TMP copy, not
  unsealed author work. `AUTHENTICATION.json` and `FIXTURE-CHECKS.json` bind them.
- Parent assembly/report: `07a7dae5db51612a23e74d1d164d33723d4d61b6` /
  `db139ae983ad66364e0367f9fb1ed0262ee61f63`.
- Accepted source delta: `bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29`, separately
  accepted by `32debb6a0e43e3ff4e27e43a09a3278b082da86a`. Complete shared.ts
  preimage matches S1, and the independently derived complete postimage matches
  bb7 exactly. No other accepted/live source, documentation or test change was
  overlaid. The accepted tests were read as supporting evidence, not executed.

| Inventory | Independently reconstructed SHA-256 |
| --- | --- |
| S1 parent source213 | `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea` |
| Overlay source213 | `2dc95c3abd7656de60d10a2f339a80d14d31ecc2b6d1a8f037769826cc8479f1` |
| Overlay full940 | `a7333f1942956f73a0cf7d16a35685f23a81186df18d89e55fe07e5a94b32b4a` |
| Overlay compiled708 | `65dda12bcf3536eefb49745037b468e7ecbf424626d1d5db137a84e12bd9298e` |
| Overlay package709 | `e207a231248d81156b6fc7b608785eb7f27cda4d34263dbee088210a19c9d010` |

The only source locus is `src/commands/network/shared.ts:10`: two named count
limits get minimum0 instead of1, retaining safe-integer validation. All other
host limits remain positive; maxTimeMs retains its upper bound. Defaults10/5,
CLI clamping, curl policy/effects, contracts and every other source stay exact.
The only changed emitted paths are shared.js, shared.js.map and shared.d.ts.map.
shared.d.ts and the other936 of940 candidate entries are identical to S1.
No additional production-path change is necessary for reconstruction.

The independent regular reconstruction is retained at
`/private/tmp/safe-bash-zero-overlay-independent-inspect-5q9y5wec`:
`candidate/` and `consumer/node_modules/virtual-bash/`. The helper copied the
authenticated parent and247 existing public tool files, applied only the allowed
source patch, removed only its own old dist and emitted fresh outputs. It did
not install dependencies, copy author compiled replacements into the build,
or copy current live product files.

Pinned Node22.22.2 SHA-256 is
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
TypeScript5.9.3 manifest is
`680240908214b87b12bb3e03f5b087525a965d7f805e6fc73579156e69e0db88`;
@types/node22.20.1 and undici-types6.21.0 match the original assembly inventories.
One public emit (343 compiler inputs) and one noEmit check (358 inputs) exit0;
14 Node parser-only checks exit0 without module evaluation. All708 newly emitted
bytes and the full940/package709 match the author inventories, including exact
sourcemap bytes without an added newline. Shared source/tool metadata and
directory shapes, copied inputs/tools and Node hash match before/after. These
are public compiler/parser checks, not a current full gate or runtime passes.

## Exact fixture review

`FIXTURE-CHECKS.json` authenticates baseline bytes, all guest inputs, driver
hashes, case data and independently constructed expected byte strings. Manual
review additionally checked the complete child/guard/driver deltas and relevant
frozen public source. Author PASS fields are not evidence of a run.

- **Surface8:** approved09ba child SHA
  `358dffdec0e11672206beb3c74d97a5cda44f55b83c8104dec9717543a2c64f4`, CASES,
  PINS, RELEASE and nine finite host-control bytes remain exact. Six supported
  surfaces, case07 DIALECT ONLY, and case08 observed-await-rejection profile are
  distinct. Case08 still tags entered/call-threw/await-rejected/fulfilled and
  rethrows the identical reason without inspection/getters/normalization. It
  does not manufacture engine.ok=false or turn a fulfilled nonzero public status
  into a rejection. No unavailable Reflect/function-spread result becomes a
  membrane proof. The dormant09 guest is retained but cannot launch; a capability
  finding stops the loop. The nine host-only controls are retained, not scheduled
  by this author freeze and not part of its25 profiles.
- **Lifecycle11:** child SHA
  `4977d53279d39c9e53b1583a93558264b140efcc784ee9811db9250c61cb7a2e`, common,
  guard and guests remain exactly3f6db. CASES differs byte-for-byte only in the
  two hostcap1->0 replacements. All11 row objects and expectations, the other
  limits, cancellation and accounting are unchanged. L05 retains the separately
  approved13-byte `owned-guest\n)` source and37-byte
  `shell: Expected command at offset 12\n` selector. It requires completed nested
  status1, release/cleanup observation before the selected syntax sink, actual
  same-executionError throw and public rejection by reference after drain.
  Earlier diagnostic attempts remain separate; their old Boolean is not the
  selector. Both L06 host caps are really0 in this new overlay version, not the
  caps1 authorization used in v2.
- **Six additional controls:** exact original curl guest through public SafeJS,
  Shell, owned-curl and explicit injected curl transport. Each retains the upload
  reused-buffer copy/gate, first chunk before EOF, both hostcaps0 and all other
  limits; each attempts `-L --max-redirs 9 --retry 9 --retry-delay 0`.
  Only503 adds supported `--fail`; no unsupported retry-all-errors flag or
  external/native transport is introduced. ROOT's latest six matched profiles
  with Retry-After1 replace the prep's explicitly pending two-profile proposal
  with Retry-After3600; the earlier prep is not edited or misrepresented.

| Pair | Required public status open/closed | Body | Header/diagnostic |
| --- | --- | --- | --- |
| Z01:200 | 0 /141 | exact body0 LF body1 LF | exact200 header; independent-stderr LF |
| Z02:503 + Retry-After1 | 22 /22 | exact `zero-body-sentinel\n` unchanged; no response reads | exact503/Retry-After header; curl22 diagnostic plus independent stderr |
| Z03:307 + Location /next | 47 /47 | exact sentinel unchanged; no response reads | exact307/Location header; curl47 diagnostic plus independent stderr |

All six require the header sentinel to be replaced. Error rows do not falsely
require a successful response body file. Required stderr is a channel, not an
invented third VFS file. Exact write-out is status|0|0|6|downloaded|curl-error-code
plus LF, followed by curl:public-status LF; closed omits only write-out. The
frozen curl source supports these expectations: CLI counts clamp to0; header
dump precedes redirect-cap refusal and --fail body suppression; zero retries
skip retry scheduling; an existing22/47 error outranks closed-output141.

Authorization and transport journals increment before any admission decision.
Each allows only its first exact URL/PUT/attempt0/no-redirect call and final
assertions require exactly one; fail-closed policy cannot hide an extra attempt.
Transport cleanup registers before upload acquisition. Owned upload fragments,
one producer start, response-body start/chunk counts, and one response disposal
plus one transport cleanup are asserted. Both cleanup completions must precede
nested settlement, which precedes public settlement; no arbitrary relative order
between those two cleanups is required. Closed-consumer events must fall between
the two upload receipts, and must not abort the transport signal. Added timer
journaling is observational only, bounded at512 entries; the1000ms discriminator
addresses this exact Retry-After1 path, not all possible timers or retry policies.

## I01 — first-nonpass scope requires ROOT clarification

This is an orchestration/coordination question, **not a source bug, failed guest,
invalid fixture or reason to weaken an assertion**.

The release says first nonpass halts later cases. The author's README:70-74
places that statement under additional controls. The exact implementation is:

- `controls/run.mjs:147` checks Z01-open and matched-open prerequisites and blocks
  all subsequent rows on first nonpass at157. `lifecycle/run.mjs` likewise stops
  after first nonpass. Missing or unexecuted rows are BLOCKED, never passes.
- `surface/run.mjs:188` records the assessment in journal.cases and returns the
  actual capture. Its loop at295 reads the capture for capability findings but
  never checks the just-recorded assessment.outcome before launching the next
  unconditional row. A normal FAIL/INVALID/BLOCKED assessment, including child
  containment, does not itself stop that loop. Finding, thrown infrastructure
  error and cohort deadline remain stop paths. Surface also has no final
  process.exitCode assignment: parent exit0 is not the cohort verdict.

Therefore I cannot attest that **all three** exact drivers enforce first-nonpass
halting. Conversely, I do not infer that ROOT intended to abandon the historical
eight-unconditional-surface policy merely from an ambiguous sentence.

ROOT can (1) explicitly scope first-nonpass halting to lifecycle/controls and
retain the sealed surface8 unconditional policy, or (2) require it for surface
too and authorize a separately frozen orchestration-only revision. The minimal
second-path delta is to inspect the just-added `journal.cases.at(-1).outcome`
before any next surface child, preserve the capability-finding publication,
record the remaining scheduled IDs as blocked and keep all finally guards and
natural child closure. Do not change a child, guest, assertion, output/reason,
budget, cleanup, signal or production file. No such revision is applied here.

The exact author admission checks only the review verdict and four identity
fields, not additional review conditions. Consequently a conditional receipt
with the permissive ALLOW verdict would silently bypass I01. `ADMISSION.json`
deliberately has a non-ALLOW verdict, so the unchanged gate refuses it. Once ROOT
resolves I01, a new immutable review receipt can bind the same or newly routed
freeze; only a separate explicit ROOT execution release can permit replay.

## Closure and remaining limits

New product/guest/private-engine/transport/native-probe executions: **0**.
New runtime passes: **0**. No private checkout queries, builds, installs or
imports occurred. No current private identity or fresh private before/after
claim is made. All owned public compiler/parser children exited; none were killed
or rescued. Own reconstruction is retained; shared originals were not modified.

The author preparation's ordering/bookkeeping/trailing-newline refusals remain
authenticated in its original receipts. One independent static helper initially
looked for unused lifecycle guests in controls; its FileNotFoundError and exact
correction are retained in `STATIC-CHECK-ATTEMPTS.json`. Only curl is a controls
guest. Correcting that inventory assumption changed no fixture or expectation.

Original surface7/8 and lifecycle8pass/1fail/1invalid/1blocked are immutable;
the old S1 constructor failure is neither rescored nor newly called invalid.
The caps1 v2 results at9f44add1 and scope addendum3e6044ff also remain distinct.
Live zero-cap acceptance was resolved separately; this review does not reopen
that issue or certify the current live tree. Env5ba1a0f3/ec4e264d coordination is
not duplicated and no Linux-kernel claim follows.

Runtime admission, fresh private identity and closure guards, actual25-profile
evidence, independent raw assessment and the later requested promotion-blocker/
production-rebase proposal remain pending. No live implementation or broader
rebase diff is started. **NO-PROMOTION; no full-security, full-gate, native-parity,
installed-private-package, superiority or feature-completion claim.**
