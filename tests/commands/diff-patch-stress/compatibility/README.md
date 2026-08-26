# Independent diff/patch edit-flow compatibility checkpoint

## Explicit oracle selection and reconciliation

See `RECONCILIATION.md` and `reconciliation-*.json` for reviewed fixture changes,
raw current counts, remaining product/dialect gaps and exact source snapshots.

The original checkpoint below is historical, including its raw Apple failures.
Current native subprocesses in compatibility and fuzz share `oracle.ts`:

```sh
export DIFF_PATCH_NATIVE_DIFF=/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff
export DIFF_PATCH_NATIVE_PATCH=/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch
node tests/commands/diff-patch-stress/compatibility/run.mjs
```

The runner executes only compatibility, fuzz, and safety, then scoped strict
TypeScript, records every diff/patch source SHA-256 before and after, and fails
on any failed check or moving source snapshot. It does not run broad tests.
The paths are host-local; build provenance is independently recorded under
`../oracle/`. Verified executables are GNU diffutils 3.12 and GNU patch 2.8.
Unset variables select `/usr/bin/diff` and `/usr/bin/patch` explicitly. Empty,
relative, missing, broken, or non-executable overrides fail, never fall back or
skip. Diagnostics include resolved path, complete version, dialect and binary
SHA-256. GNU, BSD, and other identities are distinguished; only the exact
`patch 2.0-12u11-Apple` identity receives its measured native-self expectations.

`oracle.test.ts` independently asserts forward/reverse native-self controls for
interior deletion, empty deletion, and unterminated context. Apple reverse wrong
bytes/status are asserted as calibration facts, **not product acceptance**.
Raw cross-application and fuzz failures remain red and retain their denominator;
no failed product check is skipped, marked TODO, or reclassified as a pass.
GNU cross-application must satisfy exact successful status and target bytes.
Safety has no native subprocess and receives the same invocation environment.

Immediately after adding selection, before changing semantic fixtures, the
stable GNU snapshot produced compatibility **91/99**, fuzz **28/31**, safety
**130/135**, zero skips/TODOs. All **7,168/7,168** primary seeded fuzz properties
passed (512 cases, 14 properties); the three fuzz failures were separate legacy
and boundary fixtures, not excluded corpus entries. Detailed reconciliation
and the final source snapshot are recorded separately after fixture review.

Binary SHA-256 at this checkpoint:

| Executable | SHA-256 |
| --- | --- |
| GNU diff 3.12 | `f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9` |
| GNU patch 2.8 | `c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00` |
| Apple diff | `214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede` |
| Apple patch | `ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84` |

## Historical author checkpoint

Independent leaf-verifier work on August 26, 2026. Exclusive writes are this
directory; source, author tests, safety/fuzz verifier files, root documentation,
and other workers' index entries were not modified. No packages were installed.
The author suite's 123 tests and seeded/cancellation repetitions are not counted
as independent evidence here. That suite was inspected, not rerun.

## Reproduce

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch-stress/compatibility/*.test.ts
node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node tests/commands/diff-patch-stress/compatibility/*.ts
git diff --check -- tests/commands/diff-patch-stress/compatibility
```

Latest recorded checkpoint, before this test-only commit:

- HEAD: `4670c231448dd26b47ede992de0d6ab5ac00ded2`.
- Strict owned suite: **99 tests, 75 pass, 24 fail, 0 skips, 0 cancellations,
  0 todos**, process exit **1**, reported duration **1370.025333 ms**.
- Scoped strict TypeScript: exit **0**. Its transitive source imports include
  Shell and MemoryFileSystem; this is not a whole-repository typecheck.
- No expected failure is inverted into a success, marked todo, or suppressed.
  Native-oracle defects are intentionally visible failures, not product defects.
- Source blob hashes were identical immediately before and after this run:

| Source file under `src/commands/diff-patch/` | Git blob |
| --- | --- |
| `diff.ts` | `2f926ee015a487671b0eaa94d47d33c80b9178ec` |
| `patch.ts` | `c279aab39d01ddcb12392507bd06a94e4f29c30e` |
| `unified.ts` | `984b8a93c1e07d22cf22189ec4684c762cc29169` |
| `shared.ts` | `99d12adf757d03e779d180a1d027735bed88a6cb` |
| `index.ts` | `d7bc0c3c474ff420a0b8b431aaf3ed5764935512` |

## Corpus and reference isolation

- `fixtures.ts`: 23 hand-authored patch fixtures, each tested against static
  byte/status expectations and independently against native patch: 46 tests.
- `diff.test.ts`: six flag/output fixtures with static and native checks:
  12 tests. Six edit workloads at context widths 0, 1, 2, and 5: 24 native
  cross-application tests, including forward and reverse operations.
- `gaps.test.ts`: six common-use gaps, each with static and native checks:
  12 tests. Unsupported rejection is a failure, not accepted compatibility.
- `shell.test.ts`: four actual Shell + MemoryFileSystem + diffPatchCommands
  workflows, including stdin, a real virtual pipeline, redirection, subshell
  cwd, strip, dry-run, and reversal. All four pass at the final checkpoint.
- One test emits oracle versions. Totals are test executions, not 99 unique
  workloads; the matrix is bounded and not a fuzz/performance campaign.

Commands are exercised through `createDiffPatchCommands()` and the actual
`diffPatchCommands()` plugin, never through private parser functions. Expected
bytes come from literal fixture contents and native transformations, not copied
implementation logic. Repeated-line output is cross-applied rather than forced
to match a particular LCS alignment.

Reference processes use Node's `execFile` with literal argv, no shell, a fresh
`.oracle-*` directory inside this owned directory for each invocation, a 3-second
SIGKILL timeout, and a 1-MiB output bound per captured stream. PATH, HOME, TMPDIR,
LANG, LC_ALL, and TZ are explicitly controlled. Only known target bytes are
read back; temporary directories are removed in `finally`. Product execution
receives only MemoryFileSystem and byte I/O, with a 5-second cancellation signal.

Installed references actually executed:

- `/usr/bin/diff`: `Apple diff (based on FreeBSD diff)`.
- `/usr/bin/patch`: `patch 2.0-12u11-Apple`.
- No GNU executable was installed or executed. GNU documentation is semantic
  reference evidence, not evidence of GNU differential execution.
- Missing executables cause explicit native-only skips; static goldens still
  execute. At this checkpoint neither executable was missing: **zero skips**.

## Three confirmed defects, repaired concurrently by another worker

All defects were reported in commentary before source repairs. This verifier
did not make or commit the repairs. The initial author revision was `cd49267`;
the first inspected workspace HEAD was `7fc9fd4`. Concurrent changes are why
earlier test totals differ from the final checkpoint.

1. **Explicit context overwritten by later format-only flag.**
   Minimal files: `left="old\ncontext\n"`, `right="new\ncontext\n"`.
   Argv: `diff -U0 -u -L target -L target left right`.
   Expected status 1 and `@@ -1 +1 @@` with only `-old/+new`; observed status 1
   and `@@ -1,2 +1,2 @@` including the context line. Apple diff agrees with the
   expected result. The same defect affects `--unified` and grouped `-ru` after
   explicit context. Root cause at `diff.ts:28` and `diff.ts:35`: format-only
   flags reset `context` to 3 instead of retaining an explicit value.
   Other worker's fix: `79a2ceb`. Seven independent regressions now pass.
2. **Brief output ignores labels.**
   Minimal files: `left="old\n"`, `right="new\n"`.
   Argv: `diff -q -L BEFORE -L AFTER left right`.
   Expected status 1, `Files BEFORE and AFTER differ\n`; observed status 1,
   `Files left and right differ\n`. Root cause at `diff.ts:208`: the brief
   branch interpolated operand paths rather than supplied labels. Native
   checks and static goldens cover this independently of timestamp formatting.
   Other worker's fix: `2eb05cf`. Two independent regressions now pass.
3. **Valid empty unified context rejected.**
   Target: `head\n\nold\n`. Input:

   ```diff
   --- target
   +++ target
   @@ -1,3 +1,3 @@
    head

   -old
   +new
   ```

   Expected status 0 and `head\n\nnew\n`; observed status 2,
   `patch: truncated or malformed hunk body`, with the target unchanged.
   POSIX allows an empty unaffected line with no space prefix. Apple patch
   applies it. Root cause at `unified.ts:74`: an empty physical line had no
   recognized kind. Other worker's fix: `4670c23`. Three regressions, including
   Shell+Memory literal stdin, now pass.

## Remaining failures: exact classification

### Unsupported-feature gaps: 12 failing tests

Six distinct cases, each represented by a static and native test. Native
commands successfully perform the operation; product rejection is not success.

| Case | Expected | Product observed | Source requirement |
| --- | --- | --- | --- |
| Context patch autodetection | 0; middle `old` becomes `new` | 2; unchanged; `expected --- file header` | Add context parser/dispatch, `unified.ts:14` |
| Context patch `-c` | 0; same edit | 2; `unsupported option: -c` | Format option and parser, `patch.ts:39` |
| Whitespace-tolerant patch `-l` | 0; tabbed context preserved, `old` becomes `new` | 2; `unsupported option: -l` | Matching option, `patch.ts:39`, `unified.ts:139` |
| Epoch old header without `/dev/null` | 0; absent `target` created as `created\n` | 1; target absent; `patch target does not exist` | Retain timestamp/create metadata, `unified.ts:15`, `patch.ts:100` |
| Context diff `-C1` | 1; literal context-format patch | 2; `unsupported option: -C` | Context output and option, `diff.ts:44` |
| Whitespace-ignore diff `-b` | 0; no output for `same\tword \n` versus `same word\n` | 2; `unsupported option: -b` | Comparison option, `diff.ts:44` |

The context, whitespace, and `/dev/null`-only creation boundaries were documented
by the author. These are demonstrated common-workflow gaps, not newly discovered
promises of support. Exact literal inputs and argv are in `gaps.test.ts`.

### BSD compatibility/policy differences: five failing tests

**Three zero-width-range checks.** For target `a\nb\n`, Apple patch applies
`--- target\n+++ target\n@@ -1 +1,0 @@\n-a\n` with status 0 and bytes `b\n`.
Product rejects it with status 2, `overlapping or inconsistent hunk coordinates`,
leaving `a\nb\n`. Apple diff emits this range for an initial deletion in a
repeated-line U0 workload; that generated-patch cross-application also fails.
The two literal tests preserve the issue if native tools are unavailable.

POSIX specifies `+0,0`, not `+1,0`, for an empty range at file start. The strict
continuity check at `unified.ts:62` is consistent with that rule. Therefore this
is a BSD interoperability extension/policy decision, **not evidence that the
product should generate the non-POSIX range**. Any future compatibility handling
must be narrow and retain malformed/overlapping-hunk safety checks.

**Two asymmetric-fuzz policy checks.** Target `old\nactual\n`, argv `patch -F1`,
input `--- target\n+++ target\n@@ -1,2 +1,2 @@\n-old\n+new\n expected\n`.
Apple patch returns 1 and leaves bytes unchanged; product returns 0 and writes
`new\nactual\n`. The initial assumption that native would accept this was
corrected after execution; the remaining tests explicitly identify BSD POLICY
and remain red. Product documentation permits its independent outer-context
trimming at `unified.ts:138`; do not mislabel it as a newly broken product
contract or silently require source changes to match Apple.

### Native-oracle limitations: seven failing tests

These are not source-fixer tasks. Static product reverse expectations pass.

- Interior deletion minimal repro: target for reversal `a\nc\n`; patch
  `--- target\n+++ target\n@@ -2 +1,0 @@\n-b\n`; argv `patch -R -F0`.
  Expected status 0 and `a\nb\nc\n`. Apple returns **0 but writes `b\na\nc\n`**.
  Both native diff and product diff generate the same POSIX-range patch for
  `a\nb\nc\n` to `a\nc\n`. One minimal native test remains red. A larger U0
  unequal-delta cross-application also returns 0 with the inserted line one
  position early: `...g\ni\nh\nj\nk\n` instead of `...g\nh\ni\nj\nk\n`.
- Full deletion reversal: target is an existing empty file; patch
  `--- target\n+++ target\n@@ -1,2 +0,0 @@\n-one\n-two\n`; argv `patch -R -F0`.
  Expected status 0 and `one\ntwo\n`; Apple returns **1 and retains empty bytes**.
  One minimal native test and four cross-application widths remain red. Native
  self-reversal also fails at all four widths, while product reversal succeeds.

Do not change correct product zero-range output or skip product correctness
checks merely to make this Apple reference pass. The tests report native
self-reversal status to distinguish reference limitations from product output.

## Corrected reference assumptions and remaining scope

- This Apple patch leaves a `/dev/null` deletion of an incomplete file as an
  existing empty file by default. The explicit create/delete corpus uses native
  `-E` to request removal, matching the intended product/GNU workflow. That flag
  is native-only and is declared in the fixture, not silently applied globally.
  Ordinary empty-result files are still tested as existing empty files.
- An initial pipeline probe edited the first line after adding a local prefix.
  Native patch rejected that boundary placement, although product applied it.
  The final common-case pipeline includes a leading context line to permit a
  reliable offset comparison. Asymmetric boundary behavior is separately
  retained as a visible policy mismatch, not claimed as native parity.
- No pure text diff can express an empty-file existence transition using an
  ordinary changed-line hunk. Zero-byte file creation/deletion metadata remains
  outside this delivered unified subset; this pass does not claim to solve it.
- Native GNU execution, full context/normal/ed support, binary patches, mode
  changes, all path-selection heuristics, and exhaustive flag permutations are
  not established. Other verifier scopes own safety/fuzz stress.
- No full compatibility, superiority to just-bash, whole-product green status,
  performance improvement, or 72-hour completion is claimed.

## Primary semantic references consulted

Web research used primary GNU/POSIX documentation and Apple-published source,
not third-party expected-output implementations. These references were accessed
on August 26, 2026; installed executable versions are recorded separately above.

- POSIX Issue 8 `diff`, unified empty ranges and empty unaffected lines:
  `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/diff.html`
- GNU incomplete-line markers:
  `https://www.gnu.org/software/diffutils/manual/html_node/Incomplete-Lines.html`
- GNU patch input formats:
  `https://www.gnu.org/software/diffutils/manual/html_node/patch-Input.html`
- GNU creation/removal and POSIX empty-file differences:
  `https://www.gnu.org/software/diffutils/manual/html_node/Creating-and-Removing.html`
- GNU option/fuzz/reverse/whitespace discussion, manual identifying Diffutils 3.12:
  `https://www.gnu.org/software/diffutils/manual/diffutils.html`
- Apple-published patch implementation, consulted for platform distinctions,
  not assumed to be the exact source revision of the installed executable:
  `https://raw.githubusercontent.com/apple-oss-distributions/patch_cmds/main/patch/patch.c`
