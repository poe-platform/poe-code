# Independent GNU diff author-test reconciliation

## Target, scope, and binding

On 2026-08-26 the user explicitly pinned GNU Diffutils 3.12. This leaf
verification reconciles the ten obsolete author assertions identified in
`src/commands/diff-patch/GNU-DIFF.md` after source commit
`05dee320b4ae2feed6344bf8efce8ed533631d5b`. No implementation, shared helper,
stress test, option-regression test, or patch test is changed here.

All three `diff*.test.ts` files use the shared `helpers.ts` native runner,
which resolves the default GNU profile through
`../diff-patch-stress/gnu-target/oracle.ts`. Both shared files are owned by the
concurrent test-binding worker and were consumed read-only. The option tests
now use temporary regular-file fixtures rather than two native pipe operands.
Invocations are literal argv, not shell strings; the runner enforces a
three-second deadline and combined 1-MiB stdout/stderr cap, with C locale.
Existing product stdin/pipeline tests remain intact.

The target executable is
`/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff`, reporting
`diff (GNU diffutils) 3.12`, SHA-256
`f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9`.
The central resolver checks an executable absolute path, SHA-256, and version.
`DIFF_PATCH_NATIVE_DIFF` may select another path only to the same pinned binary;
a missing or wrong binary fails rather than falling back or skipping.
The old `DIFF_WHITESPACE_ORACLE` optional path is no longer consulted in these
three owned files. GNU checks run with no oracle environment variables set.

## Ten independently inspected assertions

Native evidence was recaptured on 2026-08-26, beginning
`2026-08-26T21:28:01.864Z`, using the central GNU and named
`apple-calibration` identities. The separate Apple calibration used literal
argv, temporary fixtures, C locale, UTC, a three-second deadline, and a
64-KiB output cap. No external factual assumptions or web sources were needed.

For cases 1–7, preserve these exact inputs:

```json
{"old":"a\nb\nc\nd\ne\nf\ng\n","new":"A\nb\nc\nd\ne\nf\nG\n"}
```

Each selector array is followed by `['-L','OLD','-L','NEW','old','new']`.
Both native binaries exit 1 with empty stderr; their exact outputs differ.

| Case | Literal selector argv | Former Apple output | Required GNU output |
| --- | --- | --- | --- |
| 1 | `["-C0","-c"]` | `appleZero` | `gnuThree` |
| 2 | `["-C0","--context"]` | `appleZero` | `gnuThree` |
| 3 | `["--context=1","-rc"]` | `appleOne` | `gnuThree` |
| 4 | `["-C","0","-crc","--context"]` | `appleZero` | `gnuThree` |
| 5 | `["-c","-C0"]` | `appleZero` | `gnuThree` |
| 6 | `["--context","--context=1"]` | `appleOne` | `gnuThree` |
| 7 | `["-C0","-c","-C1","--context"]` | `appleOne` | `gnuThree` |

```json
{
  "appleZero": "*** OLD\n--- NEW\n***************\n*** 1 ****\n! a\n--- 1 ----\n! A\n***************\n*** 7 ****\n! g\n--- 7 ----\n! G\n",
  "appleOne": "*** OLD\n--- NEW\n***************\n*** 1,2 ****\n! a\n  b\n--- 1,2 ----\n! A\n  b\n***************\n*** 6,7 ****\n  f\n! g\n--- 6,7 ----\n  f\n! G\n",
  "gnuThree": "*** OLD\n--- NEW\n***************\n*** 1,7 ****\n! a\n  b\n  c\n  d\n  e\n  f\n! g\n--- 1,7 ----\n! A\n  b\n  c\n  d\n  e\n  f\n! G\n"
}
```

The seven tests now name GNU maximum-width selection and require the same
frozen complete `{exitCode, stdout, stderr}` result from both native GNU and
the implementation. They no longer rely solely on a changing live oracle.

The remaining three former tests asserted exit 2 and empty stdout:

| Case | Original literal argv | Original file bytes | Native GNU | Apple calibration |
| --- | --- | --- | --- | --- |
| 8 | `["--context=","old","new"]` | `{"old":"old","new":"new"}` | exit 1, context body | exit 1, same body |
| 9 | `["-C9007199254740992","old","new"]` | `{"old":"old","new":"new"}` | exit 1, context body | exit 2, empty stdout, usage stderr |
| 10 | `["-U9007199254740992","a","b"]` | `{"a":"a","b":"b"}` | exit 1, unified body | exit 2, empty stdout, usage stderr |

Case 8 was an invalid rejection assertion even for the captured Apple binary;
it must not be characterized as a genuine BSD/GNU disagreement. Cases 9–10
reflect Apple width rejection, not a GNU rejection requirement. No GNU source
bug was found in these ten cases, and no source fix or waiver was applied.

For reproducible complete output checks, the replacement tests add only labels
matching the existing operand names (`-L old -L new` or `-L a -L b`), keeping
the original selector, operand names, and unterminated bytes. Original unlabeled
native outputs contain temporary-file timestamps; no timestamp normalization
or partial-output comparison is used in the replacement tests. Native GNU and
the product must both produce exit 1, empty stderr, and these exact strings:

```json
{
  "cases8and9": "*** old\n--- new\n***************\n*** 1 ****\n! old\n\\ No newline at end of file\n--- 1 ----\n! new\n\\ No newline at end of file\n",
  "case10": "--- a\n+++ b\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n"
}
```

Negative, fractional, and missing-count rejection assertions remain. Width,
format-conflict, whitespace, byte-preservation, cancellation, and resource
budget coverage is retained; no expected failure becomes an optional skip.

## Apple calibration remains separate

The Apple observations above are calibration evidence, never the GNU target.
The captured binary is `/usr/bin/diff`, version
`Apple diff (based on FreeBSD diff)`, SHA-256
`214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede`.
Existing `../diff-patch-stress/compatibility/flag-evidence.json` remains
untouched, SHA-256
`34e39372383ba121d8a025d731f32abb21d6c6029f68c5d128f572a0c5a7681e`.
The historical author tests and source handoff remain available in Git;
this document records their former inputs/expectations rather than rewriting
the old evidence to imply GNU agreement.

## Validation on 2026-08-26

The initial local selection, after the concurrent helper had already switched
to GNU, had **723 tests: 625 pass, 3 fail, 95 skip, 0 cancelled, 0 todo**.
The seven dynamic context comparisons already passed under that helper; the
three old count-rejection assertions failed. This is a different denominator
from the source worker's reported expanded 746/756 selection, not a rerun or
replacement of that report.

After reconciliation the same selection has **723 tests: 723 pass, 0 fail,
0 skip, 0 cancelled, 0 todo**, duration 6260.0545 ms. No oracle environment
override was needed. The selection is exactly the three owned diff author
files plus read-only `options-regressions.test.ts`:

```sh
node --import tsx --test tests/commands/diff-patch/diff*.test.ts tests/commands/diff-patch/options-regressions.test.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node tests/commands/diff-patch/diff.test.ts tests/commands/diff-patch/diff-formats.test.ts tests/commands/diff-patch/diff-gnu-options.test.ts tests/commands/diff-patch/options-regressions.test.ts
```

The strict scoped TypeScript command exits 0 with no diagnostics. Owned-path
`git diff --check` also passes. Separate negative-binding probes execute the
named pinned GNU option identity test with `DIFF_PATCH_NATIVE_DIFF` set to
`/nonexistent/virtual-bash-gnu-diff` and `/usr/bin/diff`: both exit 1, respectively
with `ENOENT` and `pinned executable SHA-256 mismatch`. These intentionally
failing filtered probes are separate from the unfiltered 723-test acceptance
run, not omitted failures within its denominator.

Relevant SHA-256 values verified during this run:

| Path | SHA-256 |
| --- | --- |
| `src/commands/diff-patch/diff.ts` | `c3eb090a70a590992cd165486911aec51fa5dbac0e746453dbc0809fe76bc06e` |
| `src/commands/diff-patch/diff-format.ts` | `e7d66d54d65e28d152fc451d63aae1813eddf450001c0dd4dcb15ca67c941e24` |
| `tests/commands/diff-patch/diff-formats.test.ts` | `b4cdc5907e82abb90d690a495de3c98cd0223df1d8672b472943ed8d65df8e8e` |
| `tests/commands/diff-patch/diff-gnu-options.test.ts` | `5a33c0409a0b9264f9026c0b4bf7a396a7110da963c5cd313bf209db30e0dc4f` |
| `tests/commands/diff-patch/diff.test.ts` | `49c8cc5606237fa1fea4c2aedf9b9b896d6fdcffe5331bfca99ff9944cb82dd5` |
| `tests/commands/diff-patch/options-regressions.test.ts` | `efdf8195cd39783916b3a070746102f1253606fed801d3f4ba8c1d56a6f6497d` |
| `tests/commands/diff-patch/helpers.ts` | `4bc532211de440a417c305166fd2778eafa20c1d6cdc47be8293d5a5c6655ab8` |
| `tests/commands/diff-patch-stress/gnu-target/oracle.ts` | `ad9920197aa38291dfff5d04170c5e1b87cd225bf590c8073a8ebba8c68181cc` |

The two diff implementation hashes and read-only option-regression hash are
unchanged from initial inspection. Shared patch source was being edited
concurrently. Although existing diff tests include cross-application checks,
this run does **not** establish patch-suite acceptance, stress-suite acceptance,
whole-repository typechecking, complete GNU compatibility, full shell support,
product completion, superiority, or 72 hours of work.
