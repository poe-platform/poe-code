# Explicit policy migration — August 26, 2026

This note follows binding checkpoint `6bbf6a0`. Original captures, original
fixture evidence, the frozen 30 failures, and all intermediate reruns remain
unchanged. The selected target is GNU diffutils 3.12 / GNU patch 2.8, not Apple.
This leaf changed tests only and did not change product, filesystem, manifests,
root documentation, classifier, or the other verifier's `gnu-editflows` subtree.

## Explicit extension, not a hidden helper policy

Source now accepts `patch --atomic`. Tests that demand no publication after
later parse/read/budget/hunk failure, one final write for sequential sections,
or post-publication status output explicitly pass that flag and identify the
atomic extension in their names. Test helpers still pass the caller's exact
argv; none adds atomic mode implicitly. Parser fixture `args` is optional and
only the five explicitly named atomic fixtures supply `--atomic`.

The affected preflight tests are in safety bounds/cancellation/failure/sequence
tests; fuzz late-malformed-section tests; parser late-malformed-section tests;
format patch-budget tests; path sequence/truncation tests; and empty-file
delete/recreate/conflict tests. Occupied-creation vectors that require no `.rej`
or other mutation are explicitly named atomic no-publication cases. Successful
empty-file vectors continue to use default publication mode. Their default
parent-pruning expectation comes from the existing native evidence, which
already recorded `authorizedEntries: null` for `normal/-E/apply`.

Four intended repeated-section conflict tests also explicitly pass `--force`:
without it the selected GNU behavior can auto-reverse an already applied hunk.
Nested-path *positive* workloads explicitly pass `-p0` where they mean to retain
the entire header path. No default was injected into helpers. The bounded
work sweep is expanded from 180 to 512, retaining all three required outcomes
(preflight failure, partial host commit, success) despite increased source work.

Full unsafe-path, symlink, hardlink, metadata/alias, and namespace assertions
remain strict. In particular the currently failing unsupported-metadata prefix
publication checks were not moved to atomic mode or weakened. Atomic preflight
does not promise a backend transaction, rollback, or protection against races.

## Faithful default controls remain

`policy-mirrors.test.ts` adds six independently asserted controls: default and
atomic pairs for same-file partial hunks, multi-file continuation after reject,
and sequential sections. Native default controls use pinned GNU with literal
argv and explicitly selected `--batch --fuzz=0 --no-backup-if-mismatch -p0`.
They compare exact full file sets, bytes, status and diagnostics to independent
static expectations as well as live GNU. Atomic counterparts require zero
mutations for conflict and exactly one final write for a successful sequence;
default successful sequences require two writes. All six pass.

The two existing edit-flow whitespace-conflict tests remain default publication
tests and now compare GNU `.rej` files and status output rather than requiring
atomic-style empty stdout. Relative explicit targets retain relative GNU status
names; their full-path namespace and alias assertions are unchanged.
The separate owner's native full-namespace `gnu-editflows` suite is not modified
or included in this leaf's denominator.

## Coordinate and budget evidence

`coordinates-2026-08-26.json` records live pinned native-only evidence for two
old coordinate-consistency assumptions. GNU applies `1c2` to old line one,
and applies the old-coordinate sequence `-1/+1`, `-3/+4` even though the new
coordinates are not continuous. The parser fixture now requires exact positive
GNU bytes; the second-hunk fixture runs both default and atomic positive checks
against live GNU. This corrects obsolete negative assumptions, not a waiver of
either mandatory original range/fuzz gap. Historical fixtures and old failing
TAP remain available in the frozen checkpoint and this directory's first runs.

For literal `@@ -1 +1,0 @@`, reverse expectation is now GNU's `b\na\n`, while
the canonical `@@ -1 +0,0 @@` still requires `a\nb\n`. The raw GNU comparison
and boundary-rejection gates were not loosened and now pass with source fixes.

The old asymmetric repetitive work-budget input is preserved as a separate
live-GNU rejection control. A symmetric 161-line hunk now forces the intended
expensive matching workload, and still must return work-limit status 2 within
10,000 work units. Neither a budget failure nor the GNU boundary rejection is
accepted interchangeably.

## Validation and current blockers

`revision2-2026-08-26-validation.json` captures commands, hashes and raw TAP:

| Suite | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Compatibility | 110 | 0 | 110 |
| Fuzz node tests | 38 | 0 | 38 |
| Safety | 144 | 7 | 151 |
| Formats | 1,069 | 0 | 1,069 |
| Parser | 80 | 0 | 80 |
| Path regressions | 594 | 25 | 619 |
| Edit flows | 31 | 0 | 31 |
| Absolute targets | 30 | 0 | 30 |
| Empty-file delta | 83 | 6 | 89 |
| GNU binding/calibration/checker/mirrors | 27 | 0 | 27 |
| **Total** | **2,206** | **38** | **2,244** |

All skip, cancellation and TODO counts are zero. Strict scoped TypeScript exits
zero. Canonical fuzz is **7,168/7,168**, seed `1831565813`, 512 inputs, 16 families,
14 properties; this nested denominator is not added to the suite-test total.
The sixteen version-specific native-failure calibrations are counted separately
from product acceptance: six C0 in formats, five Apple and five parser in the
GNU-target suite. That suite also contains six binding, five checker, six policy
mirror tests. The original raw **2,909/2,939 with 30 failures** stays historical.

The runner detected concurrent changes to `patch.ts` and `patch-gnu-reject.ts`.
Therefore these live results are not a frozen-source checkpoint or an overall
product pass, and cannot be attributed solely to the recorded HEAD.

After explicit status-name and remaining preflight migrations,
`revision3-focused-2026-08-26.tap` is **837/859, 22 failures, zero skips** across
safety, paths and empty-file tests. Assertions for these remaining gates remain
unchanged; root/source owners must review them:

- **6 parent-pruning failures:** `patch -E /authorized/target` after a normal,
  context or unified deletion removes the target but returns `EISDIR` while
  removing empty `/authorized`. Native evidence requires status zero and parent
  absence. No filesystem edits were made; coordinate with Poincare.
- **12 strict metadata-prefix failures:** a valid first section followed by
  rename/copy/mode/similarity/binary/unknown metadata publishes the first file
  before rejecting the rest. Minimal alias-sensitive suffix:
  `new file mode 120000` between two valid sections. Existing project tests
  require status 2 with no earlier mutation, including symlink-mode metadata.
  These are retained project safety gates, not classified as GNU incompatibility
  without a separate native comparison.
- **2 GNU strip/dot regressions:** headers `./leaf` with `-p1` and `a/./leaf`
  with `-p2` are wrongly rejected as removing every filename. Unchanged native
  path evidence and positive tests require the existing `leaf` file to change.
- **1 partial-commit diagnostic failure:** injected `lstat` EIO on second file
  after publishing first produces only `patch: EIO`, losing the required
  `1/3 files committed` diagnostic. The unchanged test also protects second and
  third file bytes and forbids a second write.
- **1 missing-parent policy gate:** default creation header `missing/child`
  currently succeeds under basename selection, while the old strict namespace
  test expects failure/no mutation. Root must reconcile this explicit project
  safety requirement with the GNU path target; this leaf did not waive it or
  silently add a strip option to the negative test.

Rerun all owned scopes with `node tests/commands/diff-patch-stress/gnu-target/validate.mjs NEW-TAG`.
The runner never overwrites an existing capture and fails for a failed suite,
typecheck, skip/cancellation/TODO, or changed diff/patch source hashes.

## Remaining author routing

Author `diff-formats.test.ts` now imports the binding following owner commit
`a59dbe5`. Its former `DIFF_WHITESPACE_ORACLE` bypass is gone. The read-only
`hunk-regressions.test.ts` still has a direct `/usr/bin/${tool}` launcher near
line 22; its owner must either bind it to `oraclePath(tool)` or explicitly name
and pin it as Apple calibration. This leaf owns only author `helpers.ts`.
