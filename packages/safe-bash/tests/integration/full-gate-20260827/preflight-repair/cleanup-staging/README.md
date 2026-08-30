# Cleanup manifest handoff — 2026-08-27

Root relayed independent migration acceptance `6c6183ae`: exact candidate
`4bb4ad85d4554889cd6f59097af776f4172e34d1`, canonical10/10 with original
behavioral assertions, 14 controls and all ten retirement-mutant failures.
The verifier's 708 emitted files, 174 observed main-thread modules and worker
entry authentication are scoped observations, not worker-thread import tracing.
Original pins and ten historical full-gate failures remain unchanged.

This handoff does **not** select a successor candidate, rerun those behaviors,
accept a different build or unblock the whole gate. The new frozen SHA must
arrive from root after outstanding qualification/review decisions. The accepted
4bb expectation must not be reused for another commit, even if some source
files happen to match. The five custom first-read requirements remain unfulfilled.

## Preparation check performed

The existing `migration/replay.mjs` exports `committedInputs(fullRevision)`;
no new generator or production API is necessary. Its source and `binding.ts`
were authenticated against the accepted candidate before importing that helper.
Regeneration from explicit Git objects matches all 220 accepted input hashes,
the exact tree, and compact-envelope SHA256
`0c2f02a80388c6634df0963dfdcbb523842a44a3241e1df14d412ed78dcf56c7`.

Seven bounded preparation observations are recorded in `evidence.json`: accepted
envelope equality; rejection of wrong revision, wrong tree, changed hash and
omitted input by full equality against the regenerated envelope; rejection of
HEAD and an abbreviated revision by the helper itself. These are preparation
checks, **not** seven new cleanup scenarios or a new independent behavior gate.
No build, product test, dependency install, source edit or private access occurs.

## Required successor staging, after root's freeze

Use the existing committed-input helper with the **explicit full chosen SHA**,
not HEAD. Authenticate the helper sources to that revision before loading them.
Write the new envelope exclusively to an owned regular file outside the archived
source, and record its raw and compact-JSON hashes in the gate manifest. Record
both the selected commit and tree independently of the envelope's assertions.

Before any suite execution, independently compare:

1. Envelope revision and tree with the root-selected Git commit/tree.
2. Its complete input map with a fresh Git-derived map for that same revision.
3. The archived snapshot's `captureInputs(snapshot)` with that expected map via
   the accepted `assertCommittedInputs` helper; absence, extras, symlinks or
   changed bytes must reject rather than qualify a captured working-tree mode.
4. The same envelope and input bytes immediately before execution and afterward.

Supply both variables to the frozen canonical subprocess and its descendants:

```text
VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT=<exact full root-selected frozen SHA>
VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED=<absolute path to that new envelope>
```

Neither variable may silently fall back to HEAD, the 4bb review envelope or the
unqualified captured-working-tree profile. A candidate mismatch, altered or
missing expectation must cause admission failure before the suite. Include
bounded envelope-substitution and environment-omission controls in the successor
policy review; a previous candidate's control passes are not a substitute.

The current whole-gate policy remains deliberately bound to rejected b494.
This note does not modify that policy or bypass its refusal. Native49/49 readiness,
typing/preflight review, candidate-specific source/load binding and remaining
owner classifications are separate prerequisites. No successor envelope exists
yet because root has not selected its final candidate.

Authoritative independent behavior evidence remains
`tests/shell-stress/invocation-cleanup-runtime/migration-review/REPORT.md`.
