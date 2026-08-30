# Preparation checkpoint — August 27, 2026

PREPARATION COMPLETE; runtime acceptance and performance remain unexecuted.
Only this directory was authored. No product/root/data changes, no edits to the
main verifier, no original-five reruns, and no matching exposures occurred.

## Executed checks

- Existing local TypeScript 5.9.3 emitted three static JavaScript harness modules
  successfully; Node v22.22.2, Darwin arm64. Scope is allowJs emission, not product
  compilation, full-repository checking, or JS typechecking.
- Four standalone controls passed, one child at a time: ready/success, already
  aborted exact reason identity, benign idle-child owned timeout, and deliberately
  rejected late promise preserved by strict unhandled-rejection handling.
- Success and already-aborted children exited zero. The idle child received the
  expected exact-handle SIGKILL after its 75ms post-ready control deadline. The
  late-rejection child exited 1 with its original diagnostic captured. These two
  intentional negative outcomes are harness controls, not runtime regressions.
- Every child emitted ready, disconnected, closed both output streams and reached
  awaited close. Recorded active children: zero. No product API was imported in
  these controls; worker count zero for the successful controls.
- Syntax checks passed for guard, binding, child and benchmark. Scoped whitespace
  validation passed. No full repository tests or competing owners' suites ran.

## Frozen evidence

- `evidence/prepared.json` SHA256:
  `75e2c89496a1d7f9f19c8bb1bbbcefc3ca8898fb0fd5f263bc95f3c4a4987b87`.
- `evidence/controls.json` SHA256:
  `724f6b5ebe749fbac740fa27f04595310c42e0ca65da6bada54c7d8bc5f6ee10`.
- Prepared evidence includes all seven selected source/fixture identities for
  runtime `1b133a8662a32ee84524794842074c9c98d5f6c3`, registration
  `01aa1bffe0568cc6787d5ff8e0331e024a787385`, and fixture
  `10273352f8d65d929cbf5a23e69119414dacee60`, plus historical harness hashes and
  preparation source/compiler-emitted hashes. It preserves captured worktree
  status separately; mutable live source is not a candidate execution input.

## Prepared, explicitly not executed

README declares precise commands, authorization schema, baseline, limits and
four-row matrix. Both grep and rg have one no-caller-signal default-watchdog
case and one accepted-request caller-abort case, all with the same historical
28-`a` + `!` nested nonmatch. Defaults remain 1s active / 3s startup / 2 leases.
Proposed fixed child watchdog is 6000ms from fork, pending root approval.
Two of six additional exposures remain reserved; none of the six was consumed.
The original 12 exposures remain archived, not rerun.

The complete-command benchmark preserves the prior32 fixture and exact output,
three alternating pairs maximum, with startup and awaited disposal included and
startup separately recorded. It uses the original continuation-review baseline
closure at `329eb2722052e8ace0ec18a751f12c30ed87a25b` and archived byte manifests,
not the later cleanup harness's `07acb1a4` baseline. This explicit baseline choice
must be reviewed by root before scheduling. Benchmark watchdog: 30000ms.

Await root-provided main frozen package path/hashes and separate execution
authorization after reviewed compiled/packed original-five and actual-public
lifecycle green. No readiness marker can automatically trigger these workloads.
The authorization/import binding and product probe/benchmark paths have been
prepared and syntax-checked, NOT exercised against the pending moved package.
No runtime bug, default containment, custom-five repair, superior performance,
or broad completion is claimed. Runtime failures must be reported before fixes.
