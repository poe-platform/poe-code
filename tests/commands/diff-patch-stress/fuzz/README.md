# Independent diff/patch algorithm verification

## Oracle reconciliation update

Reviewed boundary/legacy decisions and subsequent snapshots are in
`../compatibility/RECONCILIATION.md` and `../compatibility/reconciliation-*.json`.
Legacy Apple-range goldens remain separate from strict selected-native
comparisons; an incompatible GNU result stays red rather than being waived.

The historical Apple checkpoint and `report.json` below remain immutable raw
evidence: 512 cases, 76 virtual-diff/native-patch reverse failures, plus 2 native
self-forward and 70 native-self-reverse failures. They are not product failures
merely because the selected native tool fails its own controls.

Native calls now use `DIFF_PATCH_NATIVE_DIFF` / `DIFF_PATCH_NATIVE_PATCH`, shared
with compatibility. See `../compatibility/README.md` for pinned GNU paths,
identity hashes and the three-suite strict snapshot runner. Unset means explicit
`/usr/bin` selection; invalid overrides fail without fallback or skips. Current
reports are separate from `report.json`; do not overwrite the Apple checkpoint.
The first GNU run passed all 7,168 primary corpus properties, but 3/31 standalone
tests failed because legacy/boundary assumptions needed reconciliation. This is
not a whole-product pass, a parity claim, or evidence of superiority.

## Historical author checkpoint

This is the independent algorithm/property verifier's exclusive subtree. No
product source, author tests, compatibility verifier files, safety verifier files,
or bytes commands were changed. This suite intentionally remains **red**: known
cross-tool failures are asserted and reported, not skipped, marked TODO, or turned
into assertions that rejection is correct. Do not interpret all red assertions as
virtual-bash defects; native self-controls establish important oracle limitations.

## Reproduce

Run from `/Users/kjopek/Workspace/safe-bash`, without installing anything:

```sh
node tests/commands/diff-patch-stress/fuzz/run.mjs
DIFF_PATCH_FUZZ_INDEX=45 node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/fuzz/properties.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/fuzz/regressions.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node tests/commands/diff-patch-stress/fuzz/*.ts
```

`run.mjs` imposes a hard 180-second subprocess timeout and a 2 MiB captured-output
limit via `spawnSync`. It records source hashes before/after and returns nonzero
if diff/patch source changes during a run. Individual virtual calls have a
2-second cancellation timer; individual native processes have a 2-second hard
timeout, `SIGKILL`, and 1 MiB output limit. Virtual output collection is capped at
1 MiB. The suite uses existing development-only `tsx`; helpers import only Node
builtins and product entry points. No comparator package, runtime dependency,
network request, or installation is involved in execution.

Native executions use literal argv, `/usr/bin/diff` and `/usr/bin/patch`, locale
`C`, an explicit minimal environment, and fresh `.native-*` directories **inside
this subtree**. Only generated, flat, known filenames and `/dev/null` sentinel
headers reach native patch. Temporary directories are removed in `finally`.
Malformed patches are tested against the virtual filesystem only. Missing native
executables fail visibly rather than silently reducing the denominator. Recorded
native skips: **0**, including the 32 equal-input cases: their empty patches
actually execute natively rather than being bypassed. These are Apple oracles,
not GNU binaries.

## Coverage and independence

- **512** deterministic examples: base seed `0x6d2b79f5` (`1831565813`), case seed
  `(base + Math.imul(index, 0x9e3779b9)) >>> 0`, xorshift32, indices `0..511`.
- Sixteen families have 32 examples each: empty create/delete, insert, delete,
  replace, repetitive lines, whitespace, Unicode/BOM, CRLF, terminal newline,
  long lines, separated anchors, adjacent changes, moves, equal files, and
  coding-agent import/function edits. Literal diff headers/newline-marker text
  also appear as ordinary content. Context sizes are 0, 1, 2, 3, 5, and 12.
- Every example checks status, independent shortest insertion/deletion distance,
  own diff to virtual patch forward/reverse, handwritten full-replacement patches
  forward/reverse, native diff to virtual patch forward/reverse, virtual diff to
  native patch forward/reverse, handwritten patch to native patch, and native
  diff to native patch forward/reverse: **7,168 property checks**.
- The minimality oracle is a diagonal shortest-path frontier, not the product's
  rectangular LCS table. Golden patches are assembled from explicit before/after
  bytes with full removal/addition hunks, timestamp headers, function labels, and
  incomplete-line markers; no product parser/generator implements the oracle.
- **64** additional seeded handwritten two-hunk cases, base `0x17ab0123`
  (`397082915`), use displaced unique anchors, adjacent or separated hunk ranges,
  insertion plus replacement, exact matching, and native/virtual reverse. The
  corpus uses symmetric context where native `-F0` accepts offsets. The rejected
  asymmetric variant is retained as a separate native calibration regression.
- Six permutations of three file sections cover create/edit/delete and reverse.
  Native multi-file calls explicitly use `-E` to request removal of empty files;
  virtual calls rely on documented `/dev/null` behavior. Native reverse creation
  still fails and remains a reported non-pass, not an excluded case.
- Eighteen malformed cases prepend a valid file section, then test count mismatch,
  truncation, zero/negative/noninteger ranges, ordering/coordinate mismatch,
  incomplete-line markers, and unchanged target bytes after rejection.
- Twelve actual `Shell.use(diffPatchCommands())` workflows cover piping,
  redirection, dry-run, input files/stdin, and reverse. Direct tests use
  `createDiffPatchCommands()` for tighter isolation. Author helpers/tests are not
  imported and author 100-roundtrip/cancellation evidence is not counted here.
- Four bounded algorithm tests exercise oversized and admitted repeated-line
  matrices, expensive long-line comparisons, and repetitive patch-anchor scans.

## Recorded results — August 26, 2026

Runtime: Node `v22.22.2`. Source author commit was `cd49267`; independently owned
compatibility fixes landed during verification. The pre-GAP-01-fix run inspected
revision `4670c231448dd26b47ede992de0d6ab5ac00ded2`. A later run included source
revision `378f8dc5bcd6ed3ac681ab893272ffe8921c4fb0` plus the source-fixer's
beginning-of-file zero-range normalization, subsequently committed as
`fefe825dbd1600533c2c15201a3b56a761fd42b9`. The final run's source hashes were
unchanged across the run. Latest source commit observed afterward was
`e6c3032263cbc62f8a91494a46c3102af058dcee`, with another worker's uncommitted
`diff.ts`/`diff-format.ts` changes. The recorded hashes, not that commit alone,
identify the tested diff/patch source. **The external GAP-01 fix now passes
this corpus.** Source remained read-only for this worker. `report.json` records
pre-fix and post-fix counts plus final source hashes; no whole-repo revision is
claimed to be stable while other workers commit.

Native identities, captured inside fresh isolated directories:

```text
/usr/bin/diff:  Apple diff (based on FreeBSD diff)
/usr/bin/patch: patch 2.0-12u11-Apple
```

| Property (512 cases each) | Pass | Fail |
| --- | ---: | ---: |
| Virtual diff status / independent minimality (each) | 512 | 0 |
| Own diff -> virtual forward / reverse (each) | 512 | 0 |
| Golden patch -> virtual forward / reverse (each) | 512 | 0 |
| Native diff status | 512 | 0 |
| Native diff -> virtual forward / reverse (each), after external fix | 512 | 0 |
| Own diff -> native forward | 512 | 0 |
| Own diff -> native reverse | 436 | 76 |
| Golden patch -> native forward | 512 | 0 |
| Native diff -> native forward control | 510 | 2 |
| Native diff -> native reverse control | 442 | 70 |

Before the external GAP-01 fix, the main corpus had **7,000 passing / 168 failing
checks**, including 502/512 native-input passes in each direction. After the
fix there are **7,020 passing / 148 failing checks**; remaining failures are
native-output assertions, not virtual command failures. The all-oracle denominator
is **432 fully passing / 80 non-passing seeds**, with all 512 seeds retained.
Additional results: 64/64
handwritten cases, 12/12 Shell flows, 18/18 malformed cases, and 4/4 algorithm
bounds tests pass. Six multi-file cases pass virtually and forward natively;
all six native reverse workflows fail. Overall Node tests changed from **25 pass,
6 fail** before the fix to **27 pass, 4 fail, 0 skipped** out of 31. Strict scoped
TypeScript validation passes. Final suite runtime was 21.75 seconds. This is not a
whole-repository test result or a broad superiority benchmark.

## GAP-01: native zero-context coordinates rejected

Deterministic discovery: index `45`, seed `1022091130`. Minimal reproduction:

```text
before = "a\nb\n"
after  = "b\n"

--- target
+++ target
@@ -1 +1,0 @@
-a
```

The native `diff -U0 --label target --label target old next` emits exactly that
patch. Native `patch -f -F0 -p0 target` yields `"b\n"`, exit 0, and its `-R`
invocation yields `"a\nb\n"`, exit 0. Before the external fix, virtual patch,
forward **and reverse**,
returns exit 2 with `patch: overlapping or inconsistent hunk coordinates` and
does not apply the edit. Separate regression tests assert successful forward and
reverse, so neither direction is hidden behind the other's failure.

Original source cause: `src/commands/diff-patch/unified.ts:20` interprets every empty range
as the number of preceding lines; `src/commands/diff-patch/unified.ts:60` and
`:62` demand equal old/new gaps. This native beginning-of-file convention gives
old index 0 and new index 1, rejected before applicability is considered.

Cross-input failing indices are `45, 109, 125, 266, 269, 301, 365, 370, 397, 413`.
The eight move cases are independently native-applicable in both directions.
Indices 266 and 370 insert at the beginning; their native diffs also fail their
own native-forward control, so those two cannot alone prove a virtual defect.
They remain in the failed denominator rather than being silently removed.

**Source-fixer requirements and handoff:** support the demonstrated native empty-range
convention without loosening count, ordering, overlap, or newline validation;
normalize coordinates consistently before continuity checks and reversal; cover
beginning/middle/end insertion/deletion and multi-hunk accumulated offsets.
Preserve canonical own-diff roundtrips. Do not simply delete the continuity check.
This is a demonstrated interoperability gap in an advertised zero-context
workflow, not evidence that every rejected coordinate is safe or valid.

During this assignment the separate source fixer added first-hunk normalization
when both starts are 1 and one side is empty. Both shrunk regressions and all 512
native-input forward/reverse cases then passed, with malformed cases still green.
No additional product source change is requested from the evidence collected
here. The broader boundary coverage above remains a source-fixer review gate;
native oracle disagreements below must not be “fixed” by changing product output.

## Native oracle limitations — not product-fix instructions

- Minimal incomplete-context control: native diff from `"a\nz"` to `"b\nz"`
  with `-U1` applies forward but native `patch -R -F0` fails. Virtual generated
  patches can be byte-identical to the native patches and exhibit the same native
  failure. `regressions.test.ts` keeps this calibration red.
- Of 76 own-diff/native-reverse failures, 68 have a failing native/native-reverse
  control for the same seed. The other eight are GAP-01's move cases: own diff
  emits canonical `+0,0`, native emits `+1,0`, and native reversal disagrees with
  the former. Do not change product output to match this oracle without another
  independent implementation. There are 70 total native reverse control failures.
- Minimal asymmetric context: target `"prefix\nhead\nold\ntail\n"`, patch
  `@@ -1,2 +1,2 @@` with body ` head`, `-old`, `+new`. Virtual exact offset matching
  yields `"prefix\nhead\nnew\ntail\n"`; native `-F0` rejects. This is separate
  from the 64 symmetric-context native/virtual passes.
- Apple multi-file reversal cannot recreate the deleted `stale.ts` in this
  workload: without native `-E`, it fails on the empty remaining file; with `-E`,
  it reports `No file to patch`. Virtual reverse recreates the correct content.

No GNU comparator was installed. GNU behavior is **not** inferred from Apple
identity, failure counts, or a successful virtual/golden roundtrip. Further
GNU differential validation is pending, not a pass or a silently skipped run.

## Algorithm/budget findings

- `diff.ts:68` trims only common outer prefixes/suffixes, then allocates a
  rectangular `Uint32Array` LCS matrix. Worst-case matching is quadratic in the
  unmatched line counts, with additional text-length charging. Default
  `maxMatrixCells=4,000,000` bounds the table to 16,000,000 bytes, not the whole
  process. Inputs, line arrays, edit objects, and output strings add memory.
- A small-text file with 2,102 lines and only first/last lines replaced needs
  4,422,609 cells and is rejected before table allocation at default limits.
  This documented bound is acceptable as a bounded failure, but remains a
  practical coding-agent scalability gap; it is not a successful diff or proof
  of superiority. A 352-line analogous case (124,609 cells) applies and reverses.
- `unified.ts:127` searches candidate hunk positions at each admitted fuzz level;
  repeated anchors can repeatedly scan many old lines. The repetitive 1,500-line
  target with an 81-line near-match is stopped by `maxWork=10,000`, unchanged.
- `shared.ts:116` charges comparisons by maximum UTF-16 line length plus one;
  two 20-line, 8-KiB-per-line files stop at `maxWork=25,000` before output.
  `shared.ts:53` yields on roughly 4,096 charged work units, not a wall-clock
  deadline. Synchronous decoding/split/filter/join/allocation cannot be preempted
  by the cancellation timer. Hard parent/native timeouts are separate safeguards.
- Default 16 MiB aggregate input/output, 100,000 tokenized lines, 8,000,000 work,
  1,024 files, and 10,000 hunks constrain this subset. Raising caller options is
  not an absolute memory guarantee. Binary NUL/invalid-UTF8 rejection and lack of
  binary patches are documented exclusions, not full-shell parity.

Primary external references consulted through web search, not runtime imports:

- GNU Diffutils, Detailed Unified:
  `https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html`
- GNU Diffutils, Incomplete Lines:
  `https://www.gnu.org/software/diffutils/manual/html_node/Incomplete-Lines.html`
- GNU Diffutils, Inexact:
  `https://www.gnu.org/software/diffutils/manual/html_node/Inexact.html`
- GNU Diffutils, Creating and Removing (`-E` / POSIX differences):
  `https://www.gnu.org/software/diffutils/manual/html_node/Creating-and-Removing.html`

No 72-hour completion, just-bash superiority, full-shell completion, peak-RSS
measurement, full binary compatibility, or whole-repository green status is
claimed by this bounded leaf assignment.
