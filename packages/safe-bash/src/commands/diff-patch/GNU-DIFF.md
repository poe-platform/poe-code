# GNU diff option target

## Decision and scope

On 2026-08-26 the user explicitly selected GNU as the project utility target.
GNU mismatches are defects to resolve, not an unsupported alternate profile.
This change implements GNU Diffutils 3.12 context-width selection; it does not
claim complete GNU diff, patch, shell, or cross-dialect compatibility.

Only `diff.ts`, `diff-format.ts`, the owned option regressions, and this document
change. The edit/LCS algorithm, shared contracts, patch implementation, and
independent compatibility/formats tests remain untouched. No dependencies or
runtime host-command fallback are added.

## Primary evidence

The GNU manual's `diff Options`, `Context Format`, and `Unified Format` sections
were consulted through web search. They specify the three-line bare default and
document legacy numeric options; repeated-selector details were checked against
the actual 3.12 source and executable, not inferred from that default alone.

```text
https://www.gnu.org/software/diffutils/manual/html_node/diff-Options.html
https://www.gnu.org/software/diffutils/manual/html_node/Context-Format.html
https://www.gnu.org/software/diffutils/manual/html_node/Unified-Format.html

binary: /tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff
version: diff (GNU diffutils) 3.12
SHA-256: f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9
source: /tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff.c
SHA-256: f89740750bda61c5fabc71ea26c6ea3a9e4f8623a1e765680e241ac8c559d13e
```

Relevant source locations are `diff.c:318` (initial option state), `:333`
(legacy digits), `:368` (`C`/`U`, including the long optional arguments), `:390`
and `:554` (bare short selectors), `:767` (legacy-width reconciliation), and
`:1112` (conflicting style rejection).

Native probes use literal argv, `LC_ALL=C`, `LANG=C`, a three-second timeout,
and a 64-KiB output cap. Both compared inputs are pipes (`-`, `/dev/fd/3`), so
probes neither invoke a shell nor create native fixture files. The primary
fixture has 31 unique lines named `line 1` through `line 31`, each terminated
by LF; only line 16 becomes `CHANGED`. Labels are fixed to exclude timestamps.

Selected frozen observations (all successful comparisons exit 1, stderr empty):

| Literal selector argv | Effective width / outcome |
| --- | --- |
| `-U0` | 0; `@@ -16 +16 @@` |
| `-U0 -u`, `-u -U0`, `-uU0` | 3; `@@ -13,7 +13,7 @@` |
| `-U8 -U1`, `-U1 -U8`, `-U8 -u -U1` | 8; `@@ -8,17 +8,17 @@` |
| `--unified=0 --unified`, `--unified --unified=0` | 3 |
| `-C0 -c`, `-c -C0` | 3; context range `13,19` |
| `-C8 --context=1` | 8; context range `8,24` |
| `-0` | normal format, `16c16` |
| `-0 -u`, `-u -0`, `-u0`, `-0u` | 0 |
| `-0 --unified`, `-0 --context` | 3 |
| `-0 -U1` | 1 |
| `-5 -U1` | 5 |
| `-1 -2 -u` | 12; consecutive digit options concatenate across argv |
| `-1 -u -2` | 2; a non-digit option separates numeric runs |
| `-u -c`, `-c -u`, `--normal -U0`, `-U0 --normal` | exit 2, conflicting styles |
| `-U0u`, `-u -Cbad`, `--normal --unified=bad` | exit 2, invalid context length |

Both styles accumulate the greatest requested width, starting from zero. A
bare short selector contributes three but does not mark the width explicit.
A bare long selector contributes three **and** marks it explicit, just as its
numeric form does. The final legacy numeric run replaces a non-explicit width;
with any explicit selector present, it can only increase that width. The legacy
option alone does not choose context output. Conflicting styles fail in either
order, including with brief output enabled. Invalid numeric arguments are
validated before their style is selected, as in GNU.

GNU's decimal parsing also accepts an empty numeric argument as zero, leading
ASCII whitespace, a leading plus, and negative zero; it rejects trailing
whitespace, a negative nonzero value, missing digits after a sign, fractions,
hexadecimal, and exponent notation. Very large positive widths are accepted,
not rejected as unsafe JavaScript integers. Native examples included
`--unified=`, `-U ''`, `-U +1`, `-U '\t+01'` (a literal tab in argv),
`-U -00`, and `-U999999999999999999999999999999`.

The implementation saturates numeric widths at `Number.MAX_SAFE_INTEGER` and
clamps formatting width to the actual edit-array length. For these bounded
inputs, larger GNU native integers cannot expose additional context. Work and
allocation remain bounded by input/output/line/work/hunk budgets rather than by
the requested numeric width. Diagnostics remain the library's existing format;
the tests assert error status and cause, not GNU executable-specific help text.

## Preserved BSD behavior

Commit `79a2ceb` intentionally retained the BSD explicit-width behavior. That
decision was valid for its then-selected oracle; this is an explicit target
change, not a claim that its original observations were wrong.

The unchanged independent capture is
`tests/commands/diff-patch-stress/compatibility/flag-evidence.json`, SHA-256
`34e39372383ba121d8a025d731f32abb21d6c6029f68c5d128f572a0c5a7681e`.
It preserves GNU and Apple output separately. The captured Apple binary is
`/usr/bin/diff`, `Apple diff (based on FreeBSD diff)`, SHA-256
`214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede`.

Immediately before this edit, the owned author test at repository revision
`d0fed8fb1b54ae7be4dadc1332750314d9bb108d` had SHA-256
`ef320e06b55def27100b329a1e942185d9e85cbc3e3ae292321b883f54dd87e6`;
`diff.ts` had SHA-256
`769af5df58d829ed3733ad1a24d1fbcbb02af6397cd7f4ffbce5c0f08c517599`.
The following old assertions are frozen here. With files
`left="a\nb\nc\nd\ne\nf\ng\n"`, `right="A\nb\nc\nd\ne\nf\nG\n"`
and labels `BEFORE`, `AFTER`, the old expected outputs were:

```json
{
  "zeroContext": "--- BEFORE\n+++ AFTER\n@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n",
  "oneContext": "--- BEFORE\n+++ AFTER\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -6,2 +6,2 @@\n f\n-g\n+G\n"
}
```

| Old author argv | Old expected output |
| --- | --- |
| `-U0 -u` | `zeroContext` |
| `-U0 --unified` | `zeroContext` |
| `--unified=1 -ru` | `oneContext` |
| `-U 0 -uru --unified` | `zeroContext` |
| `-u -U0` | `zeroContext` |
| `--unified --unified=1` | `oneContext` |
| `-U0 -u -U1 --unified` | `oneContext` |

All seven now expect the independently confirmed GNU three-line output. The
standalone zero/one-width controls remain covered. Two old whitespace cases,
using `old="a b\nold\n"`, `new="ab\nnew\n"`, labels `OLD`, `NEW`, were:

```json
[
  {"flags":["-wC0","-c"],"stdout":"*** OLD\n--- NEW\n***************\n*** 2 ****\n! old\n--- 2 ----\n! new\n"},
  {"flags":["-bU0","-uw"],"stdout":"--- OLD\n+++ NEW\n@@ -2 +2 @@\n-old\n+new\n"}
]
```

Those old tests used a hardcoded `/usr/bin/diff` helper. Their new frozen GNU
expectations include the first context line; live GNU checks are in
`diff-gnu-options.test.ts`, using `DIFF_WHITESPACE_ORACLE` without fallback.
The old BSD evidence is not overwritten or converted into new GNU goldens.

## Verification on 2026-08-26

All recorded tests use the pinned GNU diff above. Compatibility also selects
`/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`; the formats harness already
pins those same binaries. The independently owned test source hashes were
identical before and after each suite run.

| Suite | Before | After |
| --- | --- | --- |
| Independent compatibility | 101/110 pass, 9 fail | 110/110 pass |
| Independent formats | 1055/1069 pass, 14 fail | 1058/1069 pass, 11 fail |
| Owned options + new GNU regressions | not previously present as this matrix | 310/310 pass |
| Expanded six-file author selection | not captured before change | 746/756 pass, 10 fail |

All runs reported zero skipped, cancelled, or todo tests. The 12 named fixed
tests are the `golden diff flags:` and `native diff flags:` variants of each of
`short explicit context then short format`, `short explicit context then long
format`, `long explicit context then grouped format`, and `format then explicit
context control`; `Shell+Memory repeated format options retain GNU maximum
context`; `option interactions -C0 -c/labels=false`; `option interactions -C0
-c/labels=true`; and `GNU selector regression: -C0 followed by -c resets to three
lines`.

The 11 remaining independent format failures are unchanged: both `native-native
control` and `independent formatter` for `context/delete-3/C0`,
`context/delete-7/C0`, `context/delete-11/C0`, `context/repeated-alignment-7/C0`,
and `context/repeated-alignment-11/C0`, plus `native-native control
context/repeated-alignment-0/C0`. Observed diagnostics include GNU patch's own
replacement/line-number rejection and Apple reverse-byte calibration failure.
They remain in the denominator and require the independent classifier/patch
owners; this option task does not recategorize them as passes or change LCS
alignment to hide them.

The ten failing read-only author assertions require root-owner follow-up, not
reversion of demonstrated GNU behavior:

- Seven `context explicit count survives default selector` cases at
  `tests/commands/diff-patch/diff-formats.test.ts:159` still use the hardcoded
  BSD helper, outside the whitespace-oracle override.
- `--context=` and `-C9007199254740992` at that file's `:183` still expect
  rejection, although GNU accepts them.
- `-U9007199254740992` at `tests/commands/diff-patch/diff.test.ts:84` likewise
  expects rejection. These files were explicitly read-only for this assignment.

Reproduction commands from the repository root:

```sh
export DIFF_WHITESPACE_ORACLE=/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff
export DIFF_PATCH_NATIVE_DIFF="$DIFF_WHITESPACE_ORACLE"
export DIFF_PATCH_NATIVE_PATCH=/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch
node --import tsx --test tests/commands/diff-patch/options-regressions.cases.ts tests/commands/diff-patch/diff-gnu-options.cases.ts
node --import tsx --test tests/commands/diff-patch-stress/compatibility/*.test.ts
node --import tsx --test tests/commands/diff-patch-stress/formats/*.test.ts
node --import tsx --test tests/commands/diff-patch/{options-regressions,diff-gnu-options,diff-formats,diff,safety,shell}.cases.ts
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/commands/diff-patch/diff.ts src/commands/diff-patch/diff-format.ts tests/commands/diff-patch/options-regressions.cases.ts tests/commands/diff-patch/diff-gnu-options.cases.ts
```

The scoped strict TypeScript command passes, as does owned-path
`git diff --check`. It is not a whole-repository typecheck. Without an explicit
`DIFF_WHITESPACE_ORACLE`, native-only tests report skips rather than falling back
to BSD; frozen product cases still execute.
