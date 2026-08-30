# GNU default reconciliation checkpoint — August 26, 2026

This leaf follows `6bbf6a0` and `075bda4`. Only the assigned safety, path,
parser and new followup test scopes changed. No source, filesystem, author
helpers, existing GNU-target capture, root document or other tests changed.
All-input publication preflight is an optional `--atomic` extension, not a
requirement for ordinary GNU-compatible execution. Selected-path traversal and
alias authorization remains mandatory in both modes.

## Twelve metadata cases: valid default inputs, not preflight-only failures

Every row below uses the original mail preamble, `a/first` section, the named
literal interstitial line, and the `a/target` section with literal argv `-p1`.
There is no enclosing Git metadata envelope. GNU patch 2.8 ignores these
interstitial lines, applies both textual patches, and does not rename/copy
sentinels or change regular files into symlinks. All twelve independently return
status **0**, stdout **`patching file first\npatching file target\n`**, empty
stderr, `first = new\n`, `target = new\n`, and an otherwise unchanged complete
namespace. No backup or reject is created.

| Original interstitial metadata | Classification and required action |
| --- | --- |
| `rename from target` | Valid default input; resume parsing and publish both files |
| `rename to sentinel` | Valid default input; publish both files, leave sentinel intact |
| `copy from target` | Valid default input; resume parsing and publish both files |
| `copy to sentinel` | Valid default input; publish both files, leave sentinel intact |
| `new file mode 120000` | Valid interstitial text; retain regular-file types |
| `deleted file mode 120000` | Valid interstitial text; retain both regular files |
| `old mode 120000` | Valid interstitial text; retain regular-file types |
| `new mode 120000` | Valid interstitial text; retain regular-file types |
| `similarity index 100%` | Valid default input; publish both textual changes |
| `dissimilarity index 100%` | Valid default input; publish both textual changes |
| `GIT binary patch` | Bare interstitial line, not a binary payload; publish both textual changes |
| `unknown extension metadata` | Ignorable interstitial text; publish both textual changes |

None qualifies as *only* an obsolete all-input-preflight assertion. Therefore
none is hidden by moving it to `--atomic`, relabelled unsupported, or skipped.
Each original between-section test now requires positive native/default parity,
including exact status, diagnostics, initial and final complete namespaces.
All twelve still fail: the product publishes `first`, stops at the interstitial
line with status 2, and leaves `target` unchanged. Real Git-envelope semantics
are not waived by this finding; do not globally discard actual Git metadata.
Existing after-signature and mail-preamble safety tests are unchanged.

Three additional selected-path controls put traversal, a symlink, or a hardlink
behind the same interstitial line. All require status 2, no stdout, no attempted
mutation, and unchanged bytes/types/modes/inode/link identities throughout the
virtual namespace. All currently fail because the prefix is written before the
unparsed tail is authorized. Fix interstitial parsing **and** authorize the
complete selected-path set before any publication. Do not solve this by
silently forcing ordinary commands into atomic publication mode.

## Reconciled assertions

- The obsolete `missing-parent` negative case is replaced with two positive
  default-publication checks. With no strip option, GNU creates `child` in cwd
  and does **not** create `missing/`. With explicit `-p0`, it creates
  `missing/child` and its parent. Both also publish `first`, return 0, match
  exact status output, and preserve the rest of the complete namespace. Both
  pass. Final/ancestor/dangling/cwd/input/hardlink/directory/file-parent negative
  cases remain strict and unchanged.
- `normal-overlapping-old-hunks` and `context-overlapping-hunks` are now
  explicitly named atomic-extension fixtures, each explicitly passing
  `--atomic` and requiring status **1**, a second-hunk conflict diagnostic,
  unchanged target/other bytes, no writes, and no stdout. They are not syntax
  errors. Both pass. Helpers inject no atomic/force/profile option.
- Separate default overlap checks require native status 1, first-hunk
  publication, exact reject bytes, unchanged sentinel/other bytes, and full
  diagnostics. Both still fail only because stdout omits
  `misordered hunks! output would be garbled\n`; publication, reject bytes,
  status and namespace match. The source owner must retain the hunk-conflict
  behavior and emit the missing diagnostic before `Hunk #2 FAILED at 1.`.

The original parser helper's native argv includes `--forward`. The initial
followup capture preserves that exact native profile. A separate immutable
capture verifies identical overlap outcomes with an explicitly listed argv
without `--forward`; the final default product controls use that same argv.
An intermediate harness tried `--forward` on the product and observed
`unsupported option: --forward`. That additional CLI gap is not claimed fixed;
it is distinct from this default-publication reconciliation. The intermediate
TAP and typing errors, including a corrected evidence-variable shadow, remain
recorded rather than overwritten.

## Independent evidence

`capture.ts` and `capture-overlap.ts` run the actual local oracle through the
central fail-closed `../gnu-target/oracle.ts`: GNU diffutils 3.12 and GNU patch
2.8 version and executable hashes are checked. Native patch invocations use
literal argv, `shell: false`, a three-second SIGKILL bound, a 1 MiB output cap,
isolated temporary roots within this owned subtree, a root sentinel, and full
recursive before/after namespaces including directories and symlinks. No
external documentation was used. Capture files are exclusive-create; reruns
must not overwrite historical evidence.

- `native-2026-08-26.json`: SHA-256
  `f8c0a24126d16e72bcf520cd85914c466454c76472d8fded634fbb4ab1bc1f07`
  (12 metadata, 2 creation, 2 original native overlap profiles).
- `native-overlap-default-2026-08-26.json`: SHA-256
  `d278925c7c6311baad23c740f8170588d42627de680ca35379cb94450c6e97c4`
  (2 explicitly profiled default overlap controls).
- `native-controls.test.ts` checks all 18 live captures against pinned evidence
  and independently spelled-out status, output, byte and namespace expectations.
  These are native characterization checks, not 18 product successes.

## Exact scoped validation

Run `node tests/commands/diff-patch-stress/gnu-target-followup/validate.mjs NEW-TAG`.
The runner records exact test-file argv, raw TAP, hashes and strict scoped
TypeScript output under a fresh tag. It exits nonzero for failures, missing test
counts, skips, cancellation, TODOs, type errors, or source/test hash changes.
Source filenames and counts are discovered dynamically, never assumed.

`checkpoint-2026-08-26-validation.json` records the run from
**2026-08-26T21:49:39.558Z through 2026-08-26T21:49:42.901Z**, observing HEAD
`faca7b44e36ba6966fcd82eb32a6318fbd2ef60e`. Diff/patch source and scoped test
hashes were unchanged across that run. This is a bounded stability observation,
not proof that the actively edited repository is globally frozen or that every
imported shell/filesystem source stayed unchanged.

| Suite | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| Safety | 151 | 1 | 152 |
| Path regressions | 605 | 14 | 619 |
| Parser regressions | 80 | 0 | 80 |
| New followup | 18 | 5 | 23 |
| Total node tests | **854** | **20** | **874** |

All skips/cancellations/TODOs are zero. Strict scoped TypeScript passes. The
overall runner correctly exits 1. This is not a product-wide acceptance result.
The preliminary `before.tap` is 832/850 with 18 failures before reconciliation;
it did not record source stability. The old 837/859 focused denominator included
empty-file tests, not these parser/followup suites, so it is not comparable to
874 without accounting for suite membership.

## Remaining source guidance

The 20 live failures are **12 metadata parity + 3 metadata-tail authorization
+ 2 strip/dot + 1 commit diagnostic + 2 overlap diagnostic**. In addition to the
metadata and overlap requirements above:

- Preserve the unchanged positive `./leaf -p1` and `a/./leaf -p2` tests. Count
  literal dot components while applying the strip count before normalization;
  both must select existing `leaf`, update only its bytes, and return 0 instead
  of `strip count removes every patch filename`. Keep traversal rejection.
- Preserve the unchanged commit-stage `lstat` EIO gate: after publishing the
  first of three files, failure inspecting the second must report
  `1/3 files committed`, return 2, leave second/third bytes untouched, and never
  attempt a second write. The current result is only `patch: EIO`. Account for
  failures between publications, not just errors inside the publish call.
- The six historical parent-pruning gates remain outside this leaf's executed
  denominator and are **not waived or claimed fixed**. Per the supplied
  independently confirmed contract finding, `rm({recursive:false})` rejects
  even empty directories with `EISDIR`; nonrecursive `rmdir` is absent. Route
  that contract/backend work to Curie/Poincare. Do not substitute recursive
  deletion or weaken namespace requirements to make pruning pass.

No superiority, full GNU/Bash coverage, completion, or 72-hour work claim follows
from this checkpoint. The source owner can now fix these named gates and rerun
the exact command with a new capture tag.
