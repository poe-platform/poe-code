# Stage2 pre-integration fixture seal

**Authoritative executable fixture version: FREEZE-v2.json.** Scope: 25 actual
runtime families, one private control-order seam, six type families, and ten
targeted weakening classes reserved for candidate review. Not an implementation
acceptance, timeout-command implementation, or whole-gate claim.

Both versions use exact source `12e196af8d8b0866339747150b02ca00b9764a09`.
At capture, both invoke-option declarations lacked signal and runtime lacked any
cancellation-helper import. Reserved paths matched committed bytes before and
after each run. The independent reviewer inspected existing runtime and helper
implementation first; this is **post-helper, pre-Stage2**, not pre-helper.
Root's subsequent status supersedes the drafting status in POLICY.md:
helper `fbbe1ef7` is scoped-accepted via `61092847` / `200237e9`, with its old
10/12 result retained. Configured fallback for already-aborted unobserved controls
is explicitly included in C01; live first-delivery and settlement ranks are not
changed.

## Frozen baseline, not future acceptance

- v1: **13/26 pass, 13 fail**; zero cancel/skip/TODO.
- v2: **14/26 pass, 12 fail**; zero cancel/skip/TODO. All remaining failures are
  R02–R10, R12, R14 and R22, exercising absent Stage2 admission/delivery/provenance.
- All **six type families fail** only with missing-signal TS2353/TS2339 under
  strict ES2023/NodeNext/exactOptionalPropertyTypes. These are expected missing
  feature failures, not six successful negative compilations.
- R25's reviewer mistake is preserved, not charged to production: natural EOF
  return count was incorrectly 1. v2 requires 0 there and adds unread head-zero
  next 0 / return 1. AMENDMENT-v2.md records the full semantic/diagnostic delta.
- No source mutant was executed yet. The ten weakening classes are frozen
  obligations, not ten kills. Root must first approve and receive an integration.

Baseline execution used a fresh Git-extracted source archive and copied local
dev tooling, with an explicit product URL and a loader rejecting imports outside
the task-owned root. No live source fallback, dependency installation, product
subprocess, private checkout or source change. The same source archive was reused
for v2, not moving HEAD. All seven launches per version exited normally, without
watchdog signal, output-cap error or test cancellation; temporary roots were
removed. Original and corrected exact fixture bytes, module-load hashes, stdout,
stderr and commands are compactly retained in their respective gzip captures.

Verify without executing old tests:

```sh
node tests/shell/cancellation-stage2-independent-20260827/verify.mjs
```

The original seal runner refuses to overwrite evidence. Future candidate replay
must extract the **v2 fixture bytes** from this seal, authenticate the candidate
closure, pass its exact public module URL through STAGE2_PRODUCT_URL and execute
the same cohort. Do not run against an implicit live default or rewrite v1/v2 to
hide a failure. A candidate replay driver is deliberately not implemented before
the author's integration/write plan is approved.

## Root decisions requested before source authorization

1. Runtime `{signal: undefined}` is approved. Should both type declarations use
   `readonly signal?: AbortSignal | undefined` to support that exact object under
   exactOptionalPropertyTypes, rather than the proposal's `?: AbortSignal`?
2. Native `abort(undefined)` creates a DOMException. The freeze tests exact
   undefined in a native-branded own-reason **preaborted** fixture and in thrown
   getter/cleanup failures; live delivery uses ordinary native falsy reasons.
   Confirm this boundary, or explicitly require a stronger live-undefined delivery
   profile before adding an assertion that native controllers cannot meet.
3. “Captured unrelated execution rejection” uses the existing execution mapping:
   actual invoke env-getter rejection / Budget error, not a blanket promise that
   ordinary handler errors bypass shell diagnostics/status. Confirm interpretation;
   no extra production error-mapping change is requested.

Scope and cleanup setup remain in the real invoker. Tests do not replace it,
construct a Shell per invoke, reset Budget, or add a product race. Existing
interruptible races are not prohibited by this wording; the prohibition is a new
shortcut around invocation/cleanup settlement. No runtime authorization is issued
by this reviewer.
