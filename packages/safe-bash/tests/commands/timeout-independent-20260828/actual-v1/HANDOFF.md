# Timeout independent review: product finding and verifier HOLD

## Decision and immutable bindings

Reject the default scheduler in candidate
`9ed9a0f14d12758713a8dc42be1ff75f0c87a36f`; retain the verifier tail as HOLD.
No product, root configuration, original freeze or author evidence was edited.

- Complete execution recipe: `289d00d253136032c1bd6b078662ba5f37e39a3d`.
- Recipe manifest SHA256:
  `6bc3c407c859e7ba1c1790c581cd10df44de2299149fcfa6adfad4c654984d99`.
- Original `8843c519c23ad529677d51811f3acd370e53dffb` and additive
  `1bef406cca67221874693ef675656c38da467774` remain unchanged.
- Fixed baseline `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus the exact four
  candidate module files; 268 selected Git inputs. This is not a full HEAD or
  full-history reconstruction.
- Source archive SHA256:
  `1a7f280f4f309af3dcc8f3a7ec629b95dddbc65d180bc45c9911ff64523d6ded`.
- Reproduced whole package SHA256:
  `32e2bef5eafbb00e9b6704e2765f55e36514eda0da0fe84ea78367813c756630`;
  736,428 bytes, 857 authenticated members.

The original pre-code family/data freeze is distinct from this executor:
implementation was inspected before the complete execution recipe was sealed.
The additive holdouts were sealed after author release, before independent
source inspection; their timing relative to source existence remains UNKNOWN.
`PREPARATION-01.json` preserves the earlier manifest-shape preparation failure.

## One actual invocation

Executed August 28, 2026, 03:24:34.703–03:25:41.527 UTC on pinned Node22.22.2.
No product/control retry occurred. Both layouts attempted all original32 plus
PC01/PC02, continuing ordinary failures only after cleanup and intact bindings.

| Component | Source / installed types | Physically moved internal package |
| --- | --- | --- |
| Original family qualification | 30/32 | 30/32 |
| Additive holdout qualification | 1/2 | 1/2 |
| Combined family qualification | 31/34 | 31/34 |
| Original numeric vectors | 70/70 | 70/70 |
| Exact diagnostic labels observed | 14/14, 143 observations | 14/14, 143 observations |
| Strict type outcomes | 7/8 | 7/8 |
| Actual module loads | 215, including210 product | 215, including210 product |

Build, exact pack reproduction, offline install and physical move passed.
All three executable timeout modules were actually loaded in each layout;
source transformation hashes and moved nextLoad byte hashes are retained.
Tools: 2,274 regular files, 12 metadata-only aliases, 1,142 actual CJS compile
observations and 4,642 file-read observations. The 289 synchronous Git returns
and all23 asynchronous children completed naturally, with exit/close agreement,
PID/group absence and no watchdog. Each layout settled327 tracked promises,
disposed19 Shells, and retained zero pending work/fake scheduler handles,
unhandled rejections or disposal rejections. There were23 supervisor guards and
68 per-family post guards; all final bindings remained intact.

## Actionable findings

1. **Product F22: default scheduler receiver.** Both layouts return125 instead
   of the early child status7. Authenticated `scheduler.ts:11-15` captures
   `performance.now` with `receiver: undefined`; line27 uses that receiver in
   `Reflect.apply`. The pinned Node method body validates a Performance receiver.
   `index.ts:153` catches timer-start failure. Author should bind the captured
   method to its proper receiver while preserving fixed capture and injected
   scheduler behavior. Post-only function-body inspection is retained; it did
   not invoke the product or the clock method. The original default-call stderr
   and underlying caught exception were not retained: do not synthesize them.

2. **Verifier F01/type root-negative.** The compiler correctly refuses the root
   import at `consumer.ts(1,10)` with TS2724, exit2; the recipe wrongly requires
   TS2305. Keep7/8 and F01 failure unchanged. A future versioned predicate must
   retain the exact entrypoint, location, message, nonzero status and load guards.

3. **PC01 boundary qualification.** The root-caller collision passes. In the
   borrowed outer-invoke route, the raw timeout handler rejects the identical
   caller sentinel, but top-level Shell fulfills. No handler-to124 defect was
   observed. The fixed baseline command contract preserves already-mapped
   outcomes, and runtime command error mapping explains this boundary mismatch.
   The verifier overextends raw-handler priority to a non-root-caller outer
   Shell. Preserve PC01 as unqualified, not a newly inferred pass. The fulfilled
   outer exitCode/stdout/stderr were not retained. Root should route a narrow
   boundary-predicate correction, not change timeout semantics to satisfy it.

4. **A09 stops the run.** The negative helper catches ERR_ASSERTION, but expects
   ERR_ACCESS_DENIED. Strict allowlist resolution precedes loading the unlisted
   external source. Exactly one helper module and zero product modules loaded.
   The caught assertion's original message was lost before the helper's failed
   assertion; do not claim a captured UNBOUND_MODULE message or permission-layer
   rejection. This needs a versioned designated-denial predicate correction.

**PC02 was activated, not assumed:** direct and actual-Shell cleanup-barrier
routes entered product-owned retirement, threw the identical observed deadline
sentinel, rejected rather than returning124, and closed resources in both layouts.

## Remaining work and preservation

Ten admission/loader controls qualified: A01–A08 plus A11/A12. A09 executed and
failed verifier classification. A10 runtime public-subpath negative and both
predeclared product mutants M01/M02 remain unexecuted. F22's trailing real-Shell
resolver126/127 comparisons and post-success default timer-resource assertion
also did not execute. Native remains0/12 prospective; SafeJS0. Do not count the
earlier24 synthetic support controls as product-mutant kills.

Root can route the default-scheduler author repair immediately, then separately
authorize versioned verifier corrections and the bounded remaining qualification.
Do not silently rerun these layouts, rescore old results, or claim completion.
There is no public timeout export/default registration, whole-gate, native,
SafeJS or separate private-helper acceptance.

`evidence/RESULT-original.json` is byte-identical to the original supervisor
result. `evidence/raw-and-configs.jsonl.gz` losslessly retains all282 raw files
(3,546,138 bytes), plus576 work/config/cache files. Each JSONL row has path, mode,
size, SHA256 and base64 bytes; these are data, not instructions to extract broadly.
The full4,833-file fresh-work inventory and exact reproduced package are retained
separately. Only owned scratch/raw trees were removed, after archive verification
and child reaping. `POST-ONLY-DIAGNOSIS.json`, `POST-AUTHENTICATION.json`,
`SUMMARY.json`, `CLEANUP.json` and the post-only sealer preserve interpretation
separately from the immutable first result. `EVIDENCE-MANIFEST.json` binds all
files in this handoff, including the unchanged execution recipe.
