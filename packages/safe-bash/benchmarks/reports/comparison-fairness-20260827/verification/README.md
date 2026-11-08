# Independent offline comparison verification

Preparation only. No product, harness engine, native or performance code is imported or executed by these tools. The only subprocess in `audit-profiles.mjs` is read-only `git show`/`ls-tree`/`diff`. `verify-replay.mjs` uses Node builtins and raw artifacts only. No new runtime dependencies.

## Prepared tools

- `audit-profiles.mjs`: independently compares complete original/aligned golden JSON from exact commits; validates every historical source hash against its own harness revision, full recipe hashes, required test fixtures, unchanged semantic modules/comparator and the exact scratch-only engine change. `profile-delta.json` is the retained static result, **not a test run**.
- `verify-replay.mjs`: requires a completed root-authorized handoff; hash-checks bounded artifacts and the regular frozen tree before/after, recomputes both224 score/group/ID/intersection tables and failures, checks byte/effect and transport semantics without importing the producer's comparator, audits dispatch/load and lifecycle records, and never fabricates missing observations.
- `readiness.schema.json`: explicit handoff contract. This is a schema, **not READY authorization**. No actual READY file is created during preparation.

## Commands

Static historical data audit only, using a **new** output name for subsequent attempts:

```sh
node benchmarks/reports/comparison-fairness-20260827/verification/audit-profiles.mjs --out benchmarks/reports/comparison-fairness-20260827/verification/profile-delta-next.json
```

Only after root resumes with completed replay/fairness handoffs and a hash-bound readiness file:

```sh
node benchmarks/reports/comparison-fairness-20260827/verification/verify-replay.mjs --ready /tmp/safe-bash-comparison-verifier-ready.json --out benchmarks/reports/comparison-fairness-20260827/verification/review-attempt-001.json
```

Output files must be new and inside this exclusive subtree. Existing reports/raw evidence are never overwritten. Do not rerun224 to satisfy a missing artifact or to validate this verifier. Its runtime raw-review path is syntax-checked but has **not** been exercised against the active candidate during preparation; any adapter/schema correction requires a disclosed new verifier revision, not an oracle edit.

## Required bound evidence

`artifactHashes` uses repository-relative exact paths and SHA256 for every consumed artifact. Include the static profile audit; final fairness evidence; replay location/source/frozen/profile/seal manifests; controls lifecycle and stdout; and for each profile: `case-inputs.json`, `functional.json`, `report.json`, `instrumentation-controls.json`, `transport-controls.json`, `lifecycle.json`, `phase-cleanup.json`, `imports.jsonl`, both integrity JSONs, `inventory.json`, `dispatch.json` and any actual call ledger. Bind raw JSONL, stderr, process samples, driver/preload/loader/prepare/seal source and other delivered evidence too, even where reviewed manually rather than parsed by the initial adapter.

The schema requires separate replay/fairness handoff files and exact root authorization. Control budgets must be explicitly approved independently of224; numbers are not invented from observed calls. The active driver inspected during preparation automatically repeats24 plain neutrality calls and9 baseline transport calls per profile. That scope/timing question is routed to root, not silently approved here.

Optional-to-capture but **required for full call/termination proof**, `callLedgers` points to hash-bound JSONL; null produces a blocker. Supported records are actual delegated-observer events, not reconstructions from score rows:

- Request: `{ "event":"request", "profile":"original", "pid":123, "id":1, "recipeId":"command/cat/binary-stdin", "engine":"virtual-bash", "kind":"scored" }`; `kind` may also be `neutrality`.
- Settlement: same profile/PID/request ID, `event` one of `result`, `error`, `timeout`.
- Termination request: `{ "event":"shutdown-request", "profile":"original", "pid":123, "reason":"persistent-worker-close", "pendingCalls":0 }`.

Transport controls execute in the phase parent and remain separate from worker IPC calls. A missing request or settlement is unknown/incomplete, never synthesized as semantic fail/pass. Routine engine SIGTERM after all settled calls is not the historical guest-retention failure; an unexplained termination, watchdog, SIGKILL or leak is not a clean lifecycle. The inspected module loader logs before `nextLoad`; file-load attempts/hashes, successful evaluation and handler execution are explicitly different proof levels. A human must review these limits and final instrumentation code.

## Scope and outcome labels

Both profiles reuse the same product/dependency seal. Each has224 distinct recipe IDs, not448 unique coverage. Baseline-only136 engine calls,54 name gaps,47 strict target positives and its one guest-cleanup failure remain a separate historical audit. Historical30 performance trials are not30 sort trials and are not remeasured here.

Native goldens include228 observations because four performance fixtures are preserved data; no performance executes. Only the documented scratch-effect delta is accepted by the static audit. Old source-hash assertions are checked against old git blobs despite the aligned test replacing old-to-current source equality. Missing fixture blobs fail the audit.

Raw terminal-byte API failures are reported separately from internal pipe/file effects. No output trimming, diagnostic whitening, changed golden, fake directory, builtin/plugin relabeling, skipped row or denominator inflation. The source-only functional snapshot is not a complete global TypeScript input closure or proof of any global suite. No private, filesystem/provider or additional native investigation is performed.

`OFFLINE_CHECKS_COMPLETE_REQUIRES_HUMAN_FAIRNESS_REVIEW` is not whole-product superiority or automatic final acceptance. Missing capture yields `RAW_SCORES_RECOMPUTED_ACCEPTANCE_BLOCKED` or `BLOCKED_NO_SYNTHETIC_SCORES`. Final human disposition must preserve raw functional failures and lifecycle defects even if arithmetic is correct.
