# Independent entrypoint policy revision

August 27, 2026. User-mandated headerless executable fallback and exact
`/usr/bin/env bash` support supersede two former intentional rejection rows.
This is a TEST-ONLY correction on source READY `0f5dbb3` after `d904cf8` and
`e64ce50`, not a new product policy or source fix.

## Measured cohorts

| Cohort | Before, unchanged old tests | After correction |
| --- | --- | --- |
| Author script entrypoint | 39/41, two failures | corrected 41/41 |
| Independent script entrypoint | 17/17 | unchanged 17/17 |

All runs used strict unhandled rejection handling, tsx, TAP, concurrency 1 and
30-second outer watchdogs. No skips, TODOs, cancellations or process signals.
The only original failures were `direct script rejection has status 126 and no
body effects: plain` and the corresponding `env` case: expected126, actual0.
Raw TAP preserves exact assertion diagnostics. Historical earlier58/58 and all
old artifacts remain untouched; this new corrected58 is not renamed old proof.

## Independent native proof

Fresh whole affected cohort: both exact original bodies, both Bash profiles,
**4/4 executions**. Body bytes and modes are extracted from the frozen old
TypeScript AST, not the source author's new expected results.

| Row | Exact body hex, mode0755 | GNU5.3 | historical Bash3.2 |
| --- | --- | --- | --- |
| plain | `73617920626164` | exit0/stdout6261640a/stderr empty | same |
| env | `23212f7573722f62696e2f656e7620626173680a73617920626164` | exit0/stdout6261640a/stderr empty | same |

GNU: `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Historical: actual `/bin/bash`, SHA-256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Versions, actual argv and scrubbed C-locale environments are recorded.
Headerless execution uses the profile Bash's fallback. The env row uses actual
kernel shebang dispatch to `/usr/bin/env`, then isolated PATH bash/sh links to
that same profile. No historical /bin/bash child is mislabeled GNU. The old
registry helper `say` is represented by an isolated pinned-Bash helper emitting
the exact single-argument line; script bodies themselves are unchanged.

Generated scratch fixtures preserve their no-final-newline bytes, are confined
to this review subtree, and are removed in finally. Each native child has a
two-second watchdog and64KiB output cap. Complete before/after file bytes,
modes and symlink targets match for every row. No Python or arbitrary
interpreter was executed; no env -S/extra-argument behavior is greened here.

## Exact revision boundaries

Two positive rows replace those two rejection rows without changing their
inputs, modes, or executions. Count stays41; exact old/new names are mapped in
`corrected.json`. New assertions require exit0, text `bad\n`, exact stdout hex
`6261640a`, empty stderr bytes, unchanged source bytes/mode and namespace.
The five remaining rejection rows retain their original bodies/assertions:
noexec, noread, python, options and NUL. All other author controls are unchanged.
All17 holdouts, including invalid UTF-8 and env -S/header negatives, are
byte-identical; `tests/shell-stress/script-entrypoint/cases.ts` needed no edit.
No product mismatch was hidden by an expectation change.

Scoped TypeScript noEmit validation passed for the two cohort roots and their
transitive inputs. Actual TS import proof identifies runtime/shell paths and
confirms the index's Shell export identity. Source hashes matched READY and
remained equal across baseline and corrected windows: runtime
`fc8b4fc043068c2b8ad5efbb0a7100720424e307f54c8574bdf901a99aecd29f`.
Endpoint checks do not protect against transient write/revert; other global
guards may see this test-only edit interval (2026-08-27T03:23:20.691Z through
2026-08-27T03:25:35.646Z). No clean aggregate or whole-product claim.

## Immutable evidence and limits

Old full file text, SHA-256 and Git blob IDs for both allowed files are in
`baseline.json`; original failure output is preserved. New artifact hashes:

- baseline.json: be1d298b99903786fb277799d7c44603a3d047f5783abd4a26144f9cfd40ea97
- native.mjs: 804b2fc46e877ecff80f02ad6386c319080d58f058309eb6b66f7ee063d4445d
- native.json: 686032a03605ea1b0ab64067ee80ff1db5e0c24c7e5c46726c59b1b10093f224
- corrected.json: 12e35c803b12f160de6fa3c25408f03130b5e066d12cd064b877ab55ba13a43b

Only the author test and this new review subtree change. No invocation-modes
row, new expanded-gap fixture, budget-policy artifact, benchmark, source,
contract, manifest or runtime export changes. Old9/custom5, nearby losses and
lifecycle questions remain separate. No new dependencies, broad native/full
suite/global compiler runs, delegated agents, source-worker stop or SIGSTOP.
All bounded owned processes completed; no native scratch trees remain.
