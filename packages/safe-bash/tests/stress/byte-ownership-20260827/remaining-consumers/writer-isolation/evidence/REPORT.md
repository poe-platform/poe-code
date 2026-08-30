# Author fixture-writer evidence

Source/harness commit: `5f7fe5d72f031db6cbacc76d9bfefcba2f58d03e`.
Only the assigned canonical fixture and new author subtree changed. No product,
root configuration, other command test, historical driver, vector, pin, report,
or artifact was changed. Independent controls were frozen in
`0c5e2dff39e834fb50048386507a49116b2306fd` before the canonical edit; the author-ready
marker identifies the exact source/harness commit and SHA256s for the verifier.

## Baseline and historical mutation

`baseline.json` authenticates 1,052 current files against initial Git commit
`954406871fae381b1c69441b34946a224201d7ad`, records initial status/index, tree IDs,
ownership, exact source SHA256s, and original direct-curl bytes as base64. The
initial index was empty; foreign untracked work is recorded and preserved.
Concurrent unrelated commits advanced HEAD during inspection, not the baseline.

`baseline-reproduction.json` is an isolated selected-path Git-archive run of the
old canonical test: **2/2 pass**, yet the Buffer artifact changes from
`de63affa918da53853a7f8bc9ad1d863802c46c524e74af6b48359826139bc17` to
`ba6e0313257d6cf9a5164eec03ab7b2e23a885b10cbc84f5078c4dace0ccb0fd`.
Both byte strings are retained. They exactly match the authenticated original gate
blobs at `tests/integration/full-gate-20260827/combined-b494675c/evidence/` under
both `focused-v1/artifact-{before,after}.json.data` and
`focused-v2/artifact-{before,after}.json.data`. The precise mutated path is
`tests/stress/byte-ownership-20260827/remaining-consumers/direct-curl/artifacts/direct-registered-curl-buffer-307-replay.json`.
Stored gate blobs remain available after the gate's checkout was removed.

The historical direct-curl report and its **1 pass / 1 failure** are unchanged.
Later **2/2** results do not replace them. All 31 canonical assertion lines and
`expectations.json` bytes are unchanged by this fix.

## Validation cohorts

- First author overlay: canonical **2/2**, new controls **0/3**. Inherited
  `NODE_TEST_CONTEXT` suppressed child test execution. The initial ad-hoc type
  command also omitted the repository's ES2023-only library profile.
- Second overlay: canonical **2/2**, new controls **1/3**. The capture guard wrongly
  refused a temp-root ancestor of a disposable archive; the environment map also
  needed an explicit `NodeJS.ProcessEnv` type. These harness failures are preserved,
  not counted as passes or product failures.
- Third overlay: **5/5**, no skips/TODO/cancellations; strict scoped TypeScript
  passes with the repository's NodeNext/ES2023/Node profile. Exact SHA256s match the
  eventual source/harness commit.
- Fresh committed selected-path archive: **5/5**, no skips/TODO/cancellations.
  Controls include two parallel canonical executions, independent success capture,
  original byte assertion failure under an archive-only Buffer-alias mutant, and
  output-path/unsafe-temp-root refusals.
- Additional frozen explicit captures are retained as `frozen-success-*` and
  `frozen-corrupt-*`: success exits **0**, the deliberate archive-only mutant exits
  **1** with its failing Buffer observation, original vectors, raw TAP and actual
  source/test/driver hashes. The mutant is not a production candidate.

All 1,051 baseline-authenticated files other than the intentionally fixed canonical
source remain byte-identical in the shared tree. Exact owned archive/test/capture
directories were removed in finally blocks; processes settled, with no servers or
external network. Captures used the existing dependency-toolchain symlink, not a
fresh install. Only scoped checks ran; no whole gate was rerun.
Source/harness whitespace checks pass. The byte-exact failing TAP capture retains
two whitespace-only diagnostic lines; `git diff --check` flags those data lines.
They are preserved rather than normalized away from the authenticated capture.

The original unqualified whole gate remains **16,520 pass / 307 fail / 13 skip**.
This author evidence establishes only the writer/integrity fix. Other failure
attribution, including the 99 historical guard failures, belongs to the independent
verifier; this report makes no broad gate or superiority claim.
