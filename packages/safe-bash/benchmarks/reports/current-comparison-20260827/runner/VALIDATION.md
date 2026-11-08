# Preparation validation — August 27, 2026

**Historical v1 validation, retained rather than rewritten.** The signing/key
contract described by these original checks is superseded by revision2. See
`REVISIONS.md` for current preparation-receipt/selected-cohort checks and
`revisions/reviewed-v1/RECORD.json` for byte-identical original files/raw results.

**WAITING_ROOT; zero engine calls; no score.** This validates preparation code
and deterministic mock transcripts only. No candidate freeze or real execution
approval was supplied. No product/native/loopback/timing/private-runtime work,
new du work, staging or commit was performed.

## Executed scoped checks

| Check | Observed outcome |
| --- | --- |
| `node --check` on gate/reader/prepare/lifecycle-model/selfcheck | All five syntax checks exit0, both validation rounds |
| `node .../runner/selfcheck.mjs`, attempt001 |60/60 mock checks pass;0 unexpected failures |
| Same command after pointer/predicate/fallback refinements, attempt002 |62/62 mock checks pass;0 unexpected failures |
| `node .../runner/prepare.mjs PREPARE` | exit2, `WAITING_ROOT`, `score:null` |
| `node .../runner/prepare.mjs PREFLIGHT` | exit2, `WAITING_ROOT`, no root arguments |
| PREFLIGHT with explicitly absent freeze/approval/key paths | exit2, `WAITING_ROOT` |
| `node .../runner/prepare.mjs EXECUTE` | exit1, `FAIL_PREFLIGHT`, no executor |
| PREFLIGHT with `--allow-execute true` | exit1, `FAIL_PREFLIGHT`, unknown option |
| Independent JSON assertions on all five CLI receipts | Expected statuses, zero counters, disabled execution, absent executor and null score |

The executable full paths are in `README.md`; `...` in this table abbreviates
`benchmarks/reports/current-comparison-20260827` only. Missing-input exit2 and
rejected-mode exit1 are intentional gate outcomes, not test-suite failures or
engine outcomes. No product suite, build, native oracle, historical harness,
sibling preparer, dependency install or process stress test was run.

## Counterchecks covered

Missing freeze/auth inputs never admit reads or execution. Controls reject a
floating/unfrozen candidate, missing/stale/same-reviewer receipts, changed224
denominator/recipe/predicate, merged TMPDIR/native profiles, missing breadth
diagnostics, union score, missing entry/lock, changed baseline version, duplicate/
aliased artifacts, byte-budget excess, wrong pins/signature, approval replay and
changed payload hashes. Partial receipts are preserved on read failure. A signed
mock can reach only `PREPARED_EXECUTION_DISABLED`, never engine execution.

Mock lifecycle failures cover stalled guest/settlement/disposal, missing pipe
close, leaked worker, incomplete census, late promise, cancellation followed by
success, forced cleanup followed by natural-looking exit, output/snapshot/log/IPC
overflow, duplicate result, startup/setup/guest/settlement/snapshot/dispose/close
deadlines, watchdog failure and nonmonotonic clocks. Fallback arithmetic cannot
turn a failure into cleaned-pass; a clock already beyond the parent deadline is
explicitly flagged, not represented as a real signal sent in the past.

Reader controls hash an executable-looking data fixture without importing it and
reject directory/traversal/oversized inputs. A narrow reviewed-import allowlist
checks only the authored preparation module graph; it is not universal dynamic
module tracing, an OS sandbox, an AST security proof or complete race testing.
All lifecycle observations here are synthetic, not proof of real cancellation,
settlement, worker cleanup, TERM/KILL delivery or host process closure.

## Retained evidence and ownership

Raw directory: `/tmp/safe-bash-current-comparison-runner-checks.xRBRu2/`:

- `selfcheck-attempt-001.json` and `selfcheck-attempt-002.json`, both preserved.
- `prepare.json`, `preflight-missing.json`, `preflight-absent-files.json`.
- `execute-rejected.json`, `execute-flag-rejected.json`.
- `runner-integrity-and-environment.json`: final owned-file hash/whitespace receipt,
  Node/cwd and selected nonsecret preparation environment, not a candidate freeze.

All expected-negative control details remain in the raw mock output. There were
no unexpected failing controls to repair or discard. Historical failures remain
in their original artifacts; this leaf did not overwrite them.

The required root handoff is `/tmp/safe-bash-current-comparison-runner-detail.txt`.
Only this runner subtree and its `/tmp` evidence are authored. Other working-tree
changes and staging are not owned or modified. Source hashes cover this runner,
not a release candidate; no source tree is copied/frozen or pack built here.

Zero counters mean **runner-owned engine/native workload/child/server activity**.
Preparation naturally used shell, Git metadata and Node syntax/mock-check tool
processes. It would be false to claim zero operating-system processes overall.
The runner and selfcheck expose no engine/native/child/worker/network execution
capability; no dedicated engine process was launched. No universal host-process
census is claimed, and other owners' processes are outside this leaf's evidence.
