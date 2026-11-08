# Normal/context and whitespace stress verification

This leaf owns only this directory. Source, other tests, root documentation,
benchmarks and dependency configuration are read-only. No runtime dependencies,
packages, unsafe casts or source algorithm imports are introduced.

## Run

From `/Users/kjopek/Workspace/safe-bash`:

```sh
node tests/commands/diff-patch-stress/formats/run.mjs
node_modules/.bin/tsc --noEmit -p tests/commands/diff-patch-stress/formats/tsconfig.json
node --unhandled-rejections=strict --import tsx --test 'tests/commands/diff-patch-stress/formats/*.test.ts'
```

The runner prints per-category counts, bounded failure diagnostics, oracle
identities and source SHA-256 snapshots before/after execution. Non-passes remain
in the denominator; no required test is skipped, marked TODO or expected to fail.
The final command provides unabridged TAP. Scoped typechecking follows imported
source dependencies; it is not whole-repository validation.

## Independent expectations and coverage

- 128 deterministic input pairs, each in normal and context format: 96 unique
  generated edit sequences, 18 encoding/EOF/empty/range fixtures and 14 ambiguous
  repeated-line pairs. Context counts 0, 1, 3 and 32 rotate across edit families.
- Every pair/format has distinct native-native, virtual formatter/native parser,
  and native formatter/virtual parser gates. Both forward and reverse byte
  expectations are the independent input pair, never a virtual self-roundtrip.
- The 114 non-ambiguous pairs require exact GNU output, with stable labels and
  no timestamps removed or output normalization. Repeated alignments use cross
  application, not an arbitrary LCS tie-breaking golden. Each direction is
  required, though a failing forward assertion can prevent the reverse assertion
  in the same test from being reached; counts are gates, not completed operations.
- 28 explicit whitespace pairs provide independent static statuses for `-w`
  and `-b`, plus exact native normal/context outputs. Significant Unicode,
  Unicode normalization, BOM, whitespace-only lines, actual line boundaries and
  final-newline behavior prevent overly broad comparison normalization.
- Mixed real edits require original old/new context bytes and changed bytes,
  not normalized strings. One static context golden independently pins both
  sides. Ten mixed format/whitespace checks include unified context as a small
  supplementary whitespace check, not a rerun of the initial unified corpus.
- Hunk merging is checked at 36 independent gap/context boundaries. Brief,
  labels, output-format conflicts, large/zero context, normal ranges, `patch -l`
  empty/nonempty-blank matching, Shell plugin pipelines, small budgets and
  cancellation have focused gates.

## Oracle isolation and limitations

GNU paths, versions and SHA-256 hashes are in `FINDINGS.md`. The tests verify
versions before use and print GNU and Apple executable hashes. Native calls use
fixed executable paths and literal argv, no host shell, `LC_ALL=C`, private
temporary cwd/HOME/TMPDIR, and disabled revision-control retrieval. Files and
stdin are capped at 256 KiB, combined output at 512 KiB, target reads at 256 KiB,
and each process at three seconds. Only test-owned temporary directories are
written and removed. Oracle build directories and installed tools are read-only.

The GNU native-native gates deliberately remain failing when GNU patch rejects
its own diff's zero-context output. A virtual formatter cross-check can use Apple
patch only after GNU native-native failure is confirmed and both Apple forward
and reverse native-native controls produce exactly the original input bytes.
Apple failures are not adopted as product behavior. This secondary check does
not erase the failed GNU control or claim universal native compatibility.

Required source gaps fail normally. GNU-profile option differences are kept
separate from malformed output and parser defects. No global profile choice or
source fix is made by this verifier. See `FINDINGS.md` for baseline, final counts,
source changes and actionable handoff.

## Primary semantics references

Consulted via `web.run` on August 26, 2026; no third-party goldens:

- GNU Diffutils 3.12 manual, normal ranges and context format:
  https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Normal.html
  and https://www.gnu.org/software/diffutils/manual/diffutils.html
- GNU whitespace and incomplete-line semantics:
  https://www.gnu.org/software/diffutils/manual/html_node/White-Space.html
  and https://www.gnu.org/software/diffutils/manual/html_node/Incomplete-Lines.html
- GNU changed-whitespace patch matching:
  https://www.gnu.org/software/diffutils/manual/html_node/Changed-White-Space.html
- POSIX diff specification:
  https://pubs.opengroup.org/onlinepubs/9799919799/utilities/diff.html

GNU's manual distinguishes line boundaries from intra-line whitespace and permits
ignoring final-newline differences with whitespace options. GNU `patch -l` is not
equivalent to deleting every whitespace character. The numeric/golden assertions
are hand-specified or observed with the pinned native executables, never copied
from the implementation under test.
