# Independent preparation review — August 27, 2026

**HOLD adoption of the preparation contract unchanged; GO to retain its historical
evidence. Execution remains HOLD awaiting ROOT's future frozen70 candidate and
separate authorization.** This is not a product verdict or a request for comparisons
now. Only new `verification/**` files and isolated `/tmp` evidence were written;
no staging, commits, engines, native workloads, downloads, servers or timing runs.
Paths below are relative to `current-comparison-20260827/`.

## Exact fix requests

1. **Remove mandatory signing infrastructure.** `runner/gate.mjs:141` requires a
   ROOT key/envelope; `runner/gate.mjs:157` demands `comparisonApproved:true` even
   for disabled preparation, then mandates Ed25519. ROOT coordination approval
   binding exact manifest/artifact hashes suffices in this trusted-host workflow;
   no independent need for new signing infrastructure is established. Accept an
   explicit preparation-only coordination receipt; keep execution disabled and
   future execution approval separate. Revise CLI/docs/mocks consistently. Do not
   ask ROOT to generate keys or authorize comparisons merely to check preparation.
2. **Separate missing-native from replay prerequisites.**
   `provenance/PROVENANCE_PLAN.md:180`, `provenance/PROVENANCE_PLAN.md:240` and
   `provenance/UNAVAILABLE.json:1`
   need phase-specific applicability. Missing executables block fresh native
   capture/live-native cases that require them, not replay against authenticated
   captured old224 goldens. Breadth's declared-intent predicates are not native
   goldens and do not acquire a universal native-oracle requirement. New24 still
   need independently captured expectations before measurement. Retain every
   missing-path/3842-closure failure, but do not turn their aggregate audit exit2
   into an indiscriminate replay veto or an install/recovery requirement.
3. **Remove arbitrary document multiplicity.** `runner/gate.mjs:92` insists on
   twelve distinct role documents without establishing why evidence cannot share
   a hash-bound document with explicit selectors. Drop that packaging constraint,
   not the independent-review requirement. The four declarations required at
   `runner/gate.mjs:112` can remain a preparation inventory, but must not become
   authorization or a requirement to run all four now. Preserve null proposed
   holdout expectations, exact denominators and original/aligned identity; no
   executor implementation is requested by this review.
4. **Complete the shared-control enumeration.** `cohorts/prepare.mjs:329` emits
   only three `sharedControlIds`; `curl-positive` is the fourth shared control,
   classified separately as `shared-optional-control`. Add an explicit optional
   shared-control list or an unambiguous combined four-ID list. Keep its optional
   network configuration and recipe bytes unchanged. Preserve the reviewed v1
   seal/history when publishing the correction, rather than silently overwriting it.

## Evidence accepted within scope

- **Old224 unchanged:** all ordered recipes, stdin/file bytes and fixture metadata
  match pinned Git JSON; 168 command + 36 kernel + 12 composition + 8 curl.
  Four performance recipes explain 228 captured observations, not 228 functional
  cases. Historical scores remain 206/224 vs155/224; replay original222/224 and
  aligned223/224 vs155/224. All stored engine results match their committed sources.
- **Profiles remain separate:** only native `command/patch/dry-run` final entries
  change between captures; all448 replay engine output/status/fixture observations
  are identical. Original nonexistent fixture TMPDIR and aligned external scratch
  are not interchangeable. Mixed GNU/Darwin is not GNU/Linux; GNU sed policy and
  original BSD/file/tree defects remain qualified, not erased. Literal `type`
  output stays native `builtin/file/function` vs ours `command/command/function`.
- **Breadth accounting holds:** inventory53 = 50 formerly unmeasured + 3 historical
  controls; optional4 produce54 targets. Primary61 = targets54 + overlap3 + shared4;
  diagnostics7 yield68 recipes/136 case-engine outcomes, not a union denominator.
  Target positives0/47 and primary positives7/53 remain declared-intent results.
  Diagnostics earn no functional credit; JS guest success still fails cleanup
  (135/136 normal exits). Reviewer137 launches include one unknown lost delivery;
  12 reused +124 continuation captures give136 complete outcomes, not137.
- **Overlap/holdouts:** three explicit historical-control links retain changed
  scripts and literal `dot`/`.` labels. All12 proposed target names already overlap
  breadth; the24 scripts are new proposals with null native expectations and no
  frozen70 name binding. Mechanical byte/token matches are non-additive, not proof
  of dispatch, independence or functionality. No recipes for unspecified additions
  should be invented.
- **Authentication boundary is honest:** retained primary package proof covers
  just-bash3.4.2's955 files, not every dependency publisher. Existing receipts report
  four matching package roots, old318/3510 dependency-file trees, failed exact3842
  closure and separately matching3844 observer-inclusive closure;29 runtime/entry
  paths are byte identities, not execution/publication proof. This reviewer checked
  those receipt bindings, not their roughly488MB of underlying files again.

## Runner, duplication and stop boundary

The extractor reads Git blobs/JSON without evaluating historical harnesses; its
full reconstruction was not rerun. Copying historical observations into data and
retaining references **does not duplicate an oldgate run**. The runner's proposed
1080 case-bearing requests (896+136+48), plus potentially448 setup exec calls, are
future arithmetic only, not authorization; ROOT must approve any actual admissions.

Reader and preflight are bounded static checks, not semantic candidate acceptance.
All62 selfchecks pass; lifecycle events are synthetic. Proposed expanded caps are
15s startup,5s guest within10s request,1s settlement/snapshot/dispose/natural-close
phases,1s TERM and1s KILL-close within28s total;4MiB output/32MiB snapshots/64KiB
diagnostics/64MiB reports. Breadth remains30s/120s with50s/140s total proposals;
holdouts retain their separate proposed envelope and unresolved PATH/API mapping.
These are not actual timeout, memory or cleanup guarantees. Before later execution,
the implemented supervisor must prove bounded admission, cancellation, cooperative
settlement/disposal, natural child/pipe/owned-worker closure and sticky fallback
failure. No invented baseline dispose API, all-module trace or mandatory new signing
system is needed to accept this preparation review.

## Checks and active processes

Nine syntax checks passed. `node benchmarks/reports/current-comparison-20260827/verification/static-check.mjs`
passed using seven small committed JSON blobs and21,381,954 total input bytes,
under8MiB/file and32MiB total caps. PREPARE/missing PREFLIGHT exit2 WAITING_ROOT;
EXECUTE exits1 FAIL_PREFLIGHT. Receipts and exact reviewed hashes: `verification/CHECKS.json:1`.
The additional read-only comparison confirmed448 unchanged observations and literal
classification. No failing historical record was changed or removed.

All reviewer-launched checks/Git reads completed; **zero reviewer-owned background
jobs, engines, workers or servers remain**. Other Codex/Node host processes were
visible and untouched; this is not a host-wide quiescence claim. Stop here; ROOT
can assign the narrow preparation corrections without launching a comparison.
