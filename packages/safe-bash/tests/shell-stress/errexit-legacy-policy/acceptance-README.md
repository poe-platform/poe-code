# Legacy errexit migration: guarded baseline, then mandatory stop

The user authorized five native-backed test-row revisions after shell author
READY `6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`, subject to stopping if source
changed. The unchanged baseline completed; a subsequent source check detected
unowned command-source changes, including an actually imported module. **No
existing assertion was edited. No corrected run or acceptance is claimed.**

## Unchanged baseline

Fresh bounded runs occurred on August 27, 2026, from 05:52:29.952Z through
05:52:34.263Z. Each whole file ran once; raw TAP, original file text/git blobs,
exact actor bytes, dependency hashes and actual TypeScript load hashes are in
`acceptance-baseline.json`.

| Existing file | Pass / tests | Preserved failure |
| --- | --- | --- |
| `tests/shell/invocation-modes.test.ts` | 131 / 132 | `unimplemented invocation flags reject explicitly before source consumption`: actual 0, expected 2 |
| `tests/shell/unsupported-options.test.ts` | 1 / 2 | `unsupported errexit requests fail closed before subsequent commands`: actual 1, expected 2 |
| `tests/shell/script-entrypoint.test.ts` | 40 / 41 | `direct script rejection has status 126 and no body effects: options`: actual 0, expected 126 |

Total: **172 passed / 175 tests, 3 failed, zero skipped/cancelled/TODO**.
Before/load/after guards passed for all 592 actual load records. This is a
point-observation guard, not proof against transient write/revert or a clean
whole-product worktree. Unowned dirty files existed before the run.

The original invocation group stopped at its first `bash -e` status assertion:
17 later inputs and its final zero-read assertion were not reached. The original
set group stopped at `set -e`: its two later inputs were not reached. The options
shebang row stopped before output/diagnostic assertions. These failures do not
establish execution of every grouped assertion.

The separate pre-edit actor recorded all **22 original inputs** (18 invocation,
3 set, 1 shebang), without treating them as additional original test passes:

- `bash '-e'` and `sh '-e'`, stdin hex `73617920626164`: status 0,
  stdout `6261640a` (`bad\n`), empty stderr, no files; one acquisition each.
- The other 16 invocation inputs: status 2, unsupported-option diagnostics,
  empty stdout, no files, zero additional stdin acquisitions.
- `set -e; false; say bad >after` and
  `set -o errexit; false; say bad >after`: status 1, empty stdout/stderr bytes,
  no files (including no `after`).
- `set -eu || say unsafe >after`: retained unsupported policy, status 2,
  unsupported-shell-option diagnostic, empty stdout, no files.
- `./options`, source hex `23212f62696e2f62617368202d650a73617920626164`,
  permissions 0755: status 0, stdout `6261640a`, empty stderr, exact source
  bytes/mode/root namespace unchanged.

## Native provenance and unapplied revision

Accepted preparation commit `76d1dd721f8b6efc9417b847e14d674cf9cbae0f` and its
four original files are immutable. The reused native evidence SHA256 is
`064500b8dc1083be32e07f2fc4a67124600899fd37fd8e1abe42cc411d9f5ee8`.
Its bounded GNU Bash 5.3 and historical Bash 3.2 captures support the five
authorized row changes; product observations alone are not their authority.
The literal `/bin/bash -e` shebang executes historical 3.2 even under the GNU
parent; the separate explicit profile bridge covers the GNU child. The native
`say` helper is a documented protocol mapping, not the identical virtual program.
No new native cohort was run in this phase; existing test-owned bounded native
references were left unchanged.

The authorized but **unapplied** diff would move only two invocation `-e` rows
to exact positive assertions, change only the two supported set forms to exact
status-1/no-output/no-effect assertions, and move only the options shebang row to
exact status-0/output/source-preservation assertions. It would add two test
groups (175 to 177), retaining all original inputs and all 16 negative invocation
rows plus unsupported `set -eu`. Actual count changes in this checkpoint: zero.
Other byte-fragment, umask, env-single, allowlist, env-S and negative controls
remain byte-for-byte untouched.

## Why migration stopped

`acceptance-stop.json` records exact baseline/observed hashes. After baseline,
`src/commands/regex-execution/client.ts` changed; it was actually imported in the
baseline. `src/commands/stream-format/index.ts` and its README also changed.
The frozen shell runtime, parser and arithmetic hashes still matched. This is
not an identified errexit source bug, but it prevents the required same-source
cross-phase claim under the explicit stop-on-drift instruction. No retry,
source-author interruption, assertion revision, corrected run or typecheck was
attempted after detecting drift.

The report does not combine hidden verification or broader acceptance cohorts.
No hidden/public consumer fixture contents were read, no source/dependency/API
changes were made, and no full-Bash/parity/full-gate claim is made. Bounded child
processes completed; no delegates were created. Existing-test ownership is
relinquished. Root can serialize any later migration against current imports.
