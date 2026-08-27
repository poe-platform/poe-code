# Native-backed legacy errexit correction

This separate test-only revision implements the user's authorized five logical
row migrations for real `-e`. No source, contracts, dependencies, other tests,
native policy, or original evidence were changed.

## Corrected cohort, not an unchanged baseline

| Whole existing file | Historical live baseline | Corrected committed-source archive |
| --- | --- | --- |
| `tests/shell/invocation-modes.test.ts` | 131/132 | 133/133 |
| `tests/shell/unsupported-options.test.ts` | 1/2 | 3/3 |
| `tests/shell/script-entrypoint.test.ts` | 40/41 | 41/41 |
| Total | **172/175; 3 failed** | **177/177; 0 failed** |

The corrected files each ran once, August 27, 2026, 06:06:06.509Z–06:06:11.382Z,
including the scoped typecheck. No skipped/cancelled/TODO tests. Two added test
groups separate supported from unsupported rows; no original input was removed.
The immutable live baseline and separate actor22 are not archive tests and are
not added to this denominator. Their original grouped short-circuit limitations
remain documented in `acceptance-README.md` and raw evidence.

## Exact five-row migration

- Original `bash '-e'` and `sh '-e'`, stdin `say bad` (hex `73617920626164`):
  replace unsupported status 2 with exact status 0, stdout `bad\n` / `6261640a`,
  empty stderr text/bytes, one source acquisition each, and no files. The other
  **16** invocation rows retain status-2 diagnostics and their zero-read guard.
- Original `set -e; false; say bad >after` and
  `set -o errexit; false; say bad >after`: replace unsupported status 2 with
  exact status 1, empty stdout/stderr text/bytes, and an empty namespace (no
  `after`). `set -eu || say unsafe >after` remains exact unsupported status 2,
  its original diagnostic assertion and no-file check. No `-u` policy change.
- Original `/options`, `#!/bin/bash -e\nsay bad`, permissions 0755: replace
  status-126 unsupported-interpreter rejection with exact status 0, stdout
  `6261640a`, empty stderr, unchanged source bytes and full mode, verified 0755
  permissions, and precisely the original single-file namespace.

All other permission, interpreter, NUL/UTF-8, budget, allowlist, env-single,
env-S, byte-fragment, umask and refusal controls remain unchanged. No status
allowances, normalization, skips or weaker assertions were introduced.

## Independent native basis

The accepted 16 observations in preparation commit
`76d1dd721f8b6efc9417b847e14d674cf9cbae0f` are reused without fresh capture.
`evidence.json` SHA256:
`064500b8dc1083be32e07f2fc4a67124600899fd37fd8e1abe42cc411d9f5ee8`.
All ten affected-row observations (five rows across two profiles) independently
match the new exact statuses, output bytes and effects. The six neighboring or
bridge observations remain intact, not silently discarded.

Profiles are GNU Bash 5.3.0 on Darwin and historical `/bin/bash` 3.2.57. A literal
`/bin/bash -e` shebang selects historical 3.2 even under the GNU parent; the
separate explicit-profile bridge supplies GNU-child `-e` proof. The native `say`
helper is a documented mapping, not the identical registered virtual command.
Exact argv, locale, helper/profile hashes and roles remain in the immutable
preparation. The existing small `printf` native reference in the set test also
remains unchanged. Product output alone is not authority for this revision.

## Archive and actual-import provenance

`correction-preparation.json` records a full `git archive` of source commit
`6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`: **all 173 source files**, package,
lockfile and both tsconfigs. Every extracted file was checked against its Git
blob. Archive tar SHA256:
`a8397a9a7fa3d9a3b4480e1469a6b894cc89cd93b58f668e761505812bf3ab33`.
Frozen original tests/helpers were hash-checked against the valid live baseline,
then copied. Only the three corrected test files were subsequently replaced in
the archive. Both broad indexes were archived unchanged; no live source overlay,
wrapper, mock export, or import redirection was introduced.

The sole external link is existing repository `node_modules`, used for installed
devtools; its complete before/after manifest is preserved. Node v22.22.2 was
pinned. Each file had a 30-second process-group parent/output cap; existing child
probe limits were retained. Source runtime SHA256 is
`5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb`;
parser SHA256 is
`10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`.

Raw `correction-results.json` contains **567 actual TypeScript loads**, including
518 product loads. All resolve to archive files with matching committed blob
hashes; no archive inputs or devtools changed. The broad
`src/commands/index.ts` was loaded naturally by the original dependency graph.

**Harness qualification:** the orchestration process nevertheless exited 1:
its added `publicIndexLoaded` guard required root `src/index.ts` to execute.
These original tests do not import that root index; they import the broad
commands index. Root `src/index.ts` was present and blob-verified, but not loaded.
Thus raw `guard.valid` remains **false** despite empty input/import/blob mismatch
lists. This unnecessary harness condition is preserved, not revised or rerun to
green. It is neither a product test failure nor an archive identity mismatch.
No root-index/public-consumer execution is claimed.

One scoped TypeScript 5.9.3 check used precisely the three corrected roots and
their natural dependencies: exit 0, zero diagnostics. All 213 compiler file-read
hashes match archive inputs or pinned devtools. This is not a global typecheck.
An initial runner syntax error was fixed before archive preparation or any
product execution; the corrected cohort itself ran only once.

## Artifacts and limits

`correction-review.json` records native tuples, row deltas, artifact/test hashes
and the honest failed-harness qualification. `correction-results.json` preserves
raw TAP, original/corrected test text, actual imports and typecheck output.
The untracked archive directory named in preparation is retained for inspection,
not included in the test-only commit. All nine previous proof files remain
byte-identical to `76d1dd7` / `5d59efc`.

No hidden/public-consumer fixtures were read or run. No live-source acceptance,
global gate, full Bash, parity or completion claim is made. No unexpected product
failure was hidden by these native-backed corrections. No delegates were used;
all owned child processes completed. The three existing-test leases are
relinquished after this separate commit.
