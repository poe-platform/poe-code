# Frozen current-shell verification handoff

## Scope and independence

Only `tests/shell-stress/current-shell/**` is owned or committed. No source,
contracts, manifests, benchmarks, expanded7 fixtures or other tests were edited.
No implementation-author source/dot/eval tests or expectations were inspected.
The frozen independent definitions and native expectations were committed in
`0934888` before any product comparison. There is no source-author READY receipt
for this leaf: all observations below are preparation/pre-READY evidence, not
final implementation acceptance. No indefinite watch or automatic follow-up runs.

## Exact chronological counts

Times are UTC on August 27, 2026; these were August 26 evening in Chicago.

| Checkpoint | Native PRIMARY | Host-only | Guard/process invalid |
| --- | --- | --- | --- |
| 02:07 native freeze | 32/32 captured, both profiles | 11 requirements frozen | 0/64 native executions |
| Initial product attempt | 16/32 exact | 5/11 reported pass | 0/43; report serialization failed |
| 02:11 `pre-ready-red.json` | 16/32 exact | 5/11 reported pass | 0/43 |
| 02:12 `pre-ready-witness-red.json` | 16/32 exact | **4/11 genuine pass** | 0/43 |
| 02:13 `pre-ready-validation.json`, owned node:test | **30/32 exact** | **11/11 pass** | 0/43 assertions |

The initial completed run could not persist its JSON because passing the patch
as a process argument exceeded macOS argv capacity (`E2BIG`). The harness was
corrected to send the patch on stdin, then repeated the whole unchanged cohort.
The initial terminal verdicts are not represented as a complete raw artifact.

The first persisted output-budget result was a harness false positive: missing
`eval` emitted a diagnostic that itself exceeded the same output budget. The
corrected driver requires observed dispatch of all three intended printf commands,
with the same frozen recipe and limit. The first artifact retains the initial
classification; the second changes that row to red using a stronger execution witness.
Neither scripts nor native expected bytes changed after the freeze.

The later node:test validation ran on a concurrently updated **different** runtime:
it is not a rerun of the earlier source hash or an author-READY acceptance. It
reports 43 leaf subtests: 41 pass, 2 fail. TAP totals include the failed enclosing
test: **44 tests, 41 pass, 3 fail**, 0 skipped/cancelled/todo. The full TAP bytes are
base64 in `pre-ready-validation.json`; the two earlier JSONs retain exact per-row
observations and guards. All 43 late leaf validity assertions passed; the enclosing
source guard was stable across that full run. This does not claim a clean tree.

Focused TypeScript checking and global `tsc --noEmit` both exited 0 on the later
guarded moving-worktree hash. JavaScript harness files were syntax checked.
No unrelated fix was attempted, and this is not a build/full-suite claim.

## Remaining failures and source proposals for root

1. `source-directory`: stdout/status/effects match, but PRIMARY stderr is exactly
   `shell: line 1: .: ./work: is a directory\n`. Product reports
   `shell: line 1: ./work: not a regular file\n`. Route source-directory error
   classification and builtin context to the authorized source author.
2. `bash-child-isolation`: state, cwd, function isolation, status 127 and effects
   match. PRIMARY stderr is `shell: line 1: show: command not found\n`; product
   emits `show: command not found\n`. This is a general missing-command diagnostic
   path exposed by the isolation probe, not evidence that child state leaked.
   Root must decide source ownership/scope; the expectation stays unchanged.

Earlier red artifacts additionally show unsupported eval and all dependent state,
return/exit, Unicode, descriptor, cursor, cancellation and budget failures. Keep
them as historical observations even though the later moving source passes those
rows. No source correction was made by this leaf.

## Source and fixture identities

Frozen fixture SHA256:
`626d15198e57ce037d0f1932762a330d4f835cc3d7987f9f094888e96ca007fa`.

Frozen native JSON SHA256 (asserted by every product replay):
`7bc5b049a98609f4b1218f1cbdee6e96e0bf65fa1fac567688d35168867ce4a3`.

| Checkpoint | runtime.ts SHA256 | Import-graph SHA256 |
| --- | --- | --- |
| Native capture, runtime matches `b02bbe8` | `bb629885983de4169d8419c97f8d09be2ae1729841ae306675ce530cd8287d7c` | `b097e3932f1545e9cb3543b0d18382d2102a0a52e2d84162bb97012ad5bff47f` |
| Persisted red product runs | `a11f04a315f05962984e2a2154140cce5222359e546f5b4f49cafe07536cbda7` | `58f029d0a53a9cada5a4df681a790344bdf45b0dde069b5e5f0d80cbb78e9b45` |
| Late typechecks/node:test | `1d303091932cfca31e1c1b0de7e35609173db7bcd71cc2fb14fd5740faeb9491` | `c9c7f42701cde29922d60cf027c6feaea772ae16fc7636121d01774e19a286f1` |

The two product graph snapshots differ only in `src/shell/runtime.ts`.
**No product baseline execution on clean committed b02bbe8 is claimed**: its
runtime hash was present during native capture, but concurrent source authoring
had started before product replay. Complete per-import file hashes are recorded.

PRIMARY binary: GNU Bash 5.3.0(1)-release, aarch64-apple-darwin25.4.0;
SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
HISTORICAL binary: GNU Bash 3.2.57(1)-release, arm64-apple-darwin25;
SHA256 `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Both complete 32-row captures are retained, not selected case by case. Six native
profile differences occur in `source-missing`, `source-directory`,
`source-syntax-error`, `eval-syntax-error`, `bash-child-isolation`, and
`sh-profile-missing-fatal`; they remain visible rather than becoming exceptions.
Read README for exact argv0, launcher/profile roles, locale and coordinate mapping.

## Limits and next action

This is 32 focused native semantics plus 11 host contracts, not full Bash, general
kernel parity, cross-backend acceptance or a superiority benchmark. It does not
close the old nine historical diagnostics or five custom first-read lifecycle
limitations. No expanded7 replay was duplicated. Native input EOF rows and host
chunk-cursor rows are distinct; no new read builtin or broad syntax is demanded.

All owned child groups completed; recorded `groupAlive`, timeout and overflow
flags are false. Native temporary directories were removed. A final process-list
check found no owned native capture/product-child/test processes still running.
Foreign processes, worktree changes and staging are not claimed to be absent.

Root should resume with the exact author READY revision, run the unchanged
`run-product.mjs` into a new artifact, and keep both failures red unless genuinely
fixed. Native replay reruns both entire pinned profiles into a new file. Existing
evidence cannot be overwritten. Commit only explicitly listed owned paths.
