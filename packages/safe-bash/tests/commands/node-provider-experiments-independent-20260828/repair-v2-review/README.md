# Different bridge repair review — HOLD on F05 receipt contract

2026-08-28. Candidate **7b350bf7472cabfc2e5ed699f19c2a1c8bde2f98**;
author evidence **7b269a291d9fdc76e0760d36446d937e54060757**; recipe manifest
**3b4169c6dcb15f5f9d43e08fd417c93a38004604404cebab724cb44dbeae5f8c**.
Independent preseal **a63988b21970a5e648ab1d35ba615ce800216f56**, SHA256
b717a19a5170c096010ca74314ae8060761d324e5c6058745c42f4b20db7557a.

## Blocking finding: synchronous F05 cannot satisfy the new verifier

Author `recipe/reference-entry.mjs.data:34` emits `nativePromise:false` for a
synchronous intrinsic return. `recipe/child.mjs.data:177–185` configures F05's
require intrinsic to return the cached guest record synchronously; its
hostOperation returns non-Promise values directly at125. The unchanged F05
program calls that intrinsic twice. New `recipe/supervisor.mjs.data:379` instead
requires **every present nativePromise value to equal true**.

**P06 actual composed inert counterexample:** a real harmless child writes the
complete F05 raw/normalized artifacts and terminal receipt. Exact source identity,
32 events, counters, assertion names, public/engine settlement, retirement and
inert load-port prerequisites are bound. The full unchanged acceptEvaluation
body runs guard -> immutable -> auditLoads -> raw/normalized authentication ->
reconcileReceipt, then rejects `false !== true` at extracted subject.mjs:178.
Child exit0/natural close is independently observed, so this is not a setup,
permission, process or genuine engine failure. The exact caught assertion and
the reviewer's failed positive expectation are both retained in P06.json.

N02 changes ONLY the two flags to true in a standalone DATA counterfactual: the
remaining F05 record passes. N03 sets string "false": rejected. These unscored
diagnostics localize the predicate; they are not successful F05 engine runs or
actual stdout of the natural P06 child. No engine/factory is executed here.

**Recommended narrow author repair:** make the field validation agree with the
authenticated reference branch: synchronous F05 requires boolean false;
native-Promise settlement retains boolean true; preserve legitimate absent-field
throw branches and every other schema/order/counter/budget predicate. Bind this
to the actual frozen case/branch rather than dropping type validation or changing
the fixture to lie. Add focused false/true/wrong-type/absence branch controls,
new source/manifest seal and different review before fresh real-engine GO.
No product, guest source, factory, experiment budget or API repair is proposed.

## Prior findings and actual qualification

**20/21 qualification checks pass; one P06 failure; three unscored diagnostics;
zero unrun checks.** All ordinary-failure tail checks run after known cleanup.

- L01–L05 pass: natural child; postspawn clock failure retains exact Error;
  publication(undefined) retains exact undefined and later diagnostic failure;
  explicit outer retirement(null) after READY retains null; actual65,537-byte
  stdout hits the original65,536-byte subject bound and contains/reaps.
- Ownership/PID and real close/error listeners are observed before the injected
  publication/clock helpers. No reviewer rescue. B1's demonstrated lifecycle gap
  is closed for these actual harmless-child paths, not by a hash-only assertion.
- P01–P05 pass: whole composed inert positive plus final hostPending1,
  missing-engine-count, unsettled engine and wrong-source rejection.
- D01–D10 pass: getter/hole/read/intrinsic/tracked pending/public settlement/
  assertion inventory/nonnatural child/nonzero exit and composed raw tampering.
  Getter calls0. The old B2 contradictions no longer pass these boundaries.
- N01: standalone reordered engine-settle-before-entry remains accepted with
  balanced counts and synthetic terminal. This is NOT a demonstrated full-driver
  bypass or extra credited PASS. Bound reference runOnce:41–43 witnesses entry
  before awaiting run and settle in finally; the full source/load/raw-artifact
  composition supplies that producer precondition. Keep this limitation explicit.

## Resources, authenticity and boundaries

One invocation19:39:33.053–19:39:35.174UTC,2,121ms; outer exit1, unsafe=false.
Eleven actual harmless children: seven natural, four subject-requested SIGTERM;
all closeObserved, zero reviewer rescue, peak reviewer+child2. Subject failure
containment is not natural-success credit. All66,289 child stdout bytes and zero
stderr bytes retained in REPORT.json; complete scratch artifact capture validates
at all encoded/compressed/raw/file hash layers. Snapshot62,457 regular bytes,
51files; run evidence191,040bytes. Scratch removed only after closure/integrity.
128/64MiB old-space settings are not RSS limits or hard-preemption claims.

27 guards each authenticate40 entries. Eight whole functions exactly match
authenticated supervisor byte offsets; source/tool manifests, original guest
programs, source archive, loader and reference entry match original570e5acc bytes.
Actual helper import uses the exact9c121992… subject hash. Load prerequisites in
composed controls are explicitly authenticated INERT ports, never real engine
load evidence. Main supervisor, driver, reference entry, compiler and actual
SafeJS evaluations remain **0; all8 evaluations/seven identities HELD**.

Prior790a nine observations/four closes, reviewer rescue, original author10
observations and all failures stay unchanged. No private access, native oracle,
network, build/install, provider prototype or Worker-proposal review. NP1-CJS
global preallocation/quiescence/profile qualification remains a separate HOLD.
REVIEW.json is HOLD; no real-engine grant/token/unused run ID is issued.
