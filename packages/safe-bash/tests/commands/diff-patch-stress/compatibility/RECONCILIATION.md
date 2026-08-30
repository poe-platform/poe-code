# Independent oracle and fixture reconciliation

Recorded August 26, 2026. This worker writes only compatibility, fuzz, and safety
tests/documentation. Product, other tests, package manifests, and existing Apple
evidence are read-only. Root must route product fixes; failed expectations are
not suppressed, skipped, or marked TODO. No parity or superiority claim follows.

## Reproduce and interpret

Use the `DIFF_PATCH_NATIVE_DIFF` and `DIFF_PATCH_NATIVE_PATCH` exports in
`README.md`, then `node tests/commands/diff-patch-stress/compatibility/run.mjs`.
The runner records three complete suite summaries, primary fuzz raw counts and
failure indices, scoped strict TypeScript, and diff/patch source SHA-256 both
before and after. Nonzero status is intentional whenever any expectation fails.
`sourceChanged: true` invalidates a stable-snapshot claim and requires a rerun.
HEAD is contextual only: concurrent uncommitted source is included in hashes.
Transitive source outside `src/commands/diff-patch/` is not frozen by this runner.

`reconciliation-baseline.json` preserves the pre-fixture GNU run. Subsequent
`reconciliation-gnu.json` and `reconciliation-apple.json` are separate snapshots,
not overwrites of the original `../fuzz/report.json`. The original report's
SHA-256 remains `1d55126c087c620682c41f2e6af24a82b467a8459f5e7bf18e231648ae29c023`:
512 cases, 76 product-diff/Apple-patch reverse failures, plus 2 native-self
forward and 70 native-self reverse failures, 7,020/7,168 raw properties passing.
Native-self failures alone are not evidence of a product defect. The selected
GNU primary corpus executes the same 512 cases and all 14 properties per case.

Native calibration is a separate denominator from product acceptance. It asserts
the exact Apple reverse failures for interior deletion, empty deletion and
unterminated context, plus the F0/F1 asymmetric contrast. GNU controls require
the correct successful status and exact bytes. Raw comparison tests remain red
on unsupported dialect behavior; calibration does not erase their failures.

## Recorded results

Each cell is passed/total node tests; the primary corpus is one node test with
7,168 separately counted properties. No run has skipped, cancelled or TODO tests.

| Snapshot | Compatibility | Fuzz | Safety | Scoped strict TS |
| --- | --- | --- | --- | --- |
| GNU baseline, original fixtures | 91/99 | 28/31 | 130/135 | not embedded |
| GNU reconciled, 20:48:17 UTC | 99/110 | 34/36 | 150/151 | pass |
| Apple raw, 20:49:15 UTC | 90/110 | 31/36 | 150/151 | pass |
| GNU repeat, 20:51:18 UTC | 101/110 | 34/36 | 150/151 | pass |

All four runs had unchanged diff/patch hashes within their own execution.
Sources changed **between** runs, so these are named snapshots rather than an
unqualified same-source head-to-head claim. The repeat is pinned by
`reconciliation-gnu-repeat.json`, including all nine before/after SHA-256 values;
its contextual HEAD was `22fd7e5d46fb00409761196cbaf1ddc27f16f9bf`.
The repeat is **285/297 node tests**, 12 failures, strict TS exit 0, overall
runner exit 1. GNU primary properties are **7,168/7,168** on all three GNU runs.
The Apple raw run preserves **7,020/7,168**, with exactly 76 cross-reverse,
2 self-forward and 70 self-reverse failures. Runner syntax and owned diff
whitespace checks also passed. No source edit is part of this worker's commits.

The final repeat's remaining 12 failures are:

- Nine checks for four repeated-context option variants plus the Shell flow:
  product uses explicit context while GNU requires maximum requested context.
- One asymmetric non-EOF boundary check: GNU/Apple reject without modifying the
  file; product accepts and edits it. The two positive placement controls pass.
- One legacy Apple-range reverse comparison: contradictory dialect contracts
  described below, not a canonical GNU-output round-trip failure.
- One retained safety contract: with argv `patch target`, the input
  `--- target\n+++ /sandbox/work/target\n@@ -1 +1 @@\n-old\n+new\n` is now
  accepted with status 0 and one target write. The original test requires
  status 2 and zero writes. The corresponding unforced and dry-run cases reject.
  This does not demonstrate escape from the explicit target, but it does violate
  the existing reject-unsafe-header contract; root must route or adjudicate it.

Epoch-header creation failed both golden and GNU comparison on the earlier
snapshot, was reported before source changes, and passes on the final repeat
after another worker's changes. It is not a remaining failure at that snapshot.

Focused reproductions (keep the GNU environment exported for native checks):

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/compatibility/diff.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/fuzz/regressions.test.ts
node --unhandled-rejections=strict --import tsx --test --test-name-pattern='unsafe second header.*absolute' tests/commands/diff-patch-stress/safety/paths.test.ts
```

## Independently supported fixture changes

1. **Normal default:** the safety Shell pipeline now requests `diff -u` because
   it needs unified filename headers. Its literal filename, sentinel bytes,
   write count and destination checks are unchanged. Normal output is the
   intentional default, not a reason to weaken the patch assertions.
2. **Sequential same-target support:** before changing contradictory duplicate
   expectations, 16 coherent controls passed: four normalized/stripped aliases,
   forward/reverse, apply/dry-run. Every apply performs exactly one final write,
   preserves inode and sentinel, and every dry-run preserves the full snapshot.
   Contradictory `old->new` followed by `old->new` now expects conflict status 1,
   empty stdout, no mutations, and identical complete namespace metadata/bytes.
   No unsafe-path, symlink, hardlink, cancellation or host-failure assertion is
   weakened. Expanded independent path coverage remains another worker's scope.
3. **One-sided F1:** the prior Apple-specific negative golden is replaced with
   GNU's status 0 and `new\nactual\n`; product already matches this expectation.
   Native F0 and F1 controls retain Apple's exact rejection behavior separately.
4. **Asymmetric displaced F0:** a hunk with leading context but no trailing
   context is not allowed to match away from EOF by GNU patch 2.8 or installed
   Apple patch. The fixture now expects rejection and unchanged bytes, with
   passing EOF and balanced-context controls. Product's more permissive match
   remains a failing compatibility assertion, not a newly invented policy.
5. **Repeated context flags:** six independent native-only captures per dialect
   are retained in `flag-evidence.json`. GNU takes the largest requested context
   (`-u` contributes 3); installed Apple retains explicit `-U` context instead.
   GNU goldens now require three-context bytes for the four formerly BSD-shaped
   combined options, with a standalone `-U0` control and a Shell regression.
   Product mismatches remain failures. The raw Apple comparison is not removed.

## Unresolved legacy range interpretation

The historical GAP-01 literal is `@@ -1 +1,0 @@` followed by `-a`. With reverse
input `b\n`, GNU patch produces `b\na\n`, while Apple and the current legacy
product contract produce `a\nb\n`. This is not GNU's own zero-context output:
GNU emits `@@ -1 +0,0 @@`, which reverses to `a\nb\n` correctly.

The retained legacy product goldens and the newly separated raw selected-oracle
comparison deliberately expose the conflict. Both are executed. The latter
fails under GNU rather than treating the dialect difference as a pass. Canonical
GNU forward/reverse controls were added. No decision to remove legacy support
or grant a GNU-parity exception has been authorized; root must resolve that
contract choice explicitly. It is distinct from the unsafe-header regression.

## Evidence and primary semantic sources

The independent oracle worker's `../oracle/capture.json`, SHA-256
`4c47c20760aef82c29dae4a3fc8169ef45cad1649fd17b1d84fc489b05cfd261`, supplies native
records `asymmetric-F0-control`, `asymmetric-F1`, `displaced-exact-F0` and its EOF
and symmetric controls, and cross-generated `zero-begin-delete-reverse` cases.
It was inspected read-only, not rewritten to match product output.

Our native-only flag capture SHA-256 is
`34e39372383ba121d8a025d731f32abb21d6c6029f68c5d128f572a0c5a7681e`.
`oracle.test.ts` replays its six selected-dialect records with exact output and
status. Unlike source-produced goldens, this capture runs only native binaries.

GNU's primary Diffutils manual was consulted using `web.run`:

- `https://www.gnu.org/software/diffutils/manual/diffutils.html`: normal format
  is the default; context/unified are explicit formats; incomplete final lines
  are represented distinctly.
- `https://www.gnu.org/software/diffutils/manual/html_node/Context.html`:
  context matching can accommodate offsets, but does not promise every
  asymmetric placement will be accepted.

The pinned official source distribution provides the more precise boundary
rule in `patch-2.8/patch.man`, lines 96–99 (SHA-256
`f2a475f289f9b57715341813fe85e82c52380ae4b88279eba5ced9023ea0baca`): unequal
prefix/suffix context constrains placement at file boundaries after fuzz.
`diffutils-3.12/src/diff.c`, lines 368–386 and 554–557 (SHA-256
`f89740750bda61c5fabc71ea26c6ea3a9e4f8623a1e765680e241ac8c559d13e`), independently
confirms maximum context selection, not last-option selection. Local primary
source and measured native behavior, not a generic manual inference, support
these exact cases. Distribution/signature provenance is in `../oracle/README.md`.
