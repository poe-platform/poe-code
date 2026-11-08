# Actual SafeJS / owned-output lifecycle preparation

**PREPARED, NOT EXECUTED.** This is the lifecycle/budget reviewer's frozen plan,
not the prototype author's receipt, receipt reconciliation, surface audit, or a
runtime verdict. ROOT has not released execution. Guest executions, engine
imports, product imports/builds, native probes and dependency installs: **zero**.

Owner: `tests/integration/safejs-owned-output-prototype-review/lifecycle/**` only.
Thread: `01a04292-c8dd-7331-9dac-619c9861b11b`. No delegation. No surface reviewer's
new cases or expectations were read before this freeze.

## Frozen scope

- **Six logical workflows / eleven execution rows**, all `UNRUN_RELEASE_REQUIRED`.
- Existing public SafeJS `stdio`/`command` facades and the explicitly injected
  public `makeSafeJsShellModule`; actual Shell registry/invoke boundaries.
- Finite aliases and Promise callbacks, a paired step-budget control, invocation
  lifetime, explicit operation parent/children, error precedence, and one
  streaming curl workflow with open/closed stdout controls and independent files.
- An approved host command opts in with the actual `createOutputOperation`.
  The SafeJS command itself does **not** opt in; this plan does not require it to.
- No raw sink, output operation, signal, cleanup hook, acquisition/release
  callback, or new probe/control module is granted to guest code.

`CASES.json` fixes row order, inputs, limits and outcomes. `guests/*.ajs.data`
contains inert guest bytes, not poe-code CLI harnesses. `HARNESS-PLAN.md` fixes
host construction, causal schedules, ownership assertions and containment.
`SOURCE-PINS.json` records read-only source inspection and receipt identities.
`FREEZE.json` binds all preparation files. `verify-freeze.mjs` only reads/hashes
these files and pinned Git receipts; it cannot execute a probe or write captures.

## Candidate and authentication boundary

Preparation evidence: `f666ad8c76ea4362b093ee52e3e7e3b5c3702916`.
Final Q1 evidence: `e57b5aa16f749b6fac558877dff0712e64df05a8`, not a product commit.
S1/S2 source: **213 files**,
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`.
Candidate: **940 files / 708 compiled artifacts**; no later Q1 source patch.
Actual private engine pin: `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`.

The preparation seal and `/tmp/safe-bash-owned-output-provenance-handoff-result.txt`
are retrieved inputs, **not independent authentication of the chain or current
prepared assembly**. This reviewer only compares the prepared bytes read for
planning with those recorded manifests. The independent receipt verifier must
reconcile the original chain, Q archive and current assembly before ROOT releases
execution. No current-live prototype is imported or overlaid.

## Execution prerequisites

1. Sealed independent receipt-reconciliation verdict covering both chain/Q archive
   and the current prepared assembly, followed by explicit ROOT release.
2. Fresh private before/after snapshots using `GIT_OPTIONAL_LOCKS=0`: HEAD/tree,
   index bytes/mode/times, status/staging, six metadata files and all 264 engine
   files. Any drift is captured without reset or attribution; no live fallback.
3. Separately owned regular TMP copies of the authenticated package, source-hook
   engine, loader and cached tools; no symlinks, engine build or installation.
4. Materialize the execution driver under a new versioned owned path from this
   plan, bind its exact bytes and all load paths **before the first child**. Driver
   implementation cannot silently change these inputs, schedules or criteria.
5. Per-row real-engine syntax/reachability is initially **UNPROVED**. Invalid
   syntax, absent APIs, missing positive controls or unobservable ordering cannot
   become a security pass. Preserve any failure before proposing a correction.

No execution runner is installed in this preparation commit. There is no polling
for another worker or implicit release flag. Stop after the preparation handoff.

## Non-claims

Historical first-read five remain prototype **1/5**, captured baseline **0/5**;
API-opt-in **5/5** is a different cohort. Historical Q1 **32/32**, integration
`5009ba8` **18/19**, migration `656ee2b0` **19/19**, and review `1602a` are context,
not this audit's scores. Production gate **8670** is unaffected. No production
owned-output authorization, environment/shebang change, first-read API, native
parity, opaque hard preemption, general membrane security or full-product claim.
