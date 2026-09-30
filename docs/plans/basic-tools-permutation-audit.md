# Basic tools permutation audit

Audit `true`, `false`, `echo`, `pwd`, `basename`, `dirname`, and `printf` against explicit Bash and GNU utility profiles. Finite generated matrices supplement boundary and upstream regression cases; they do not establish exhaustive coverage of unbounded inputs.

1. Establish current source and maintained focused test baselines.
2. Compare option ordering, operand counts, empty values, slash runs, suffix overlap, escapes, numeric boundaries, format reuse, locale behavior, and raw bytes. Include command handlers and shell invocation paths.
3. Obtain upstream Bash, Zsh, or coreutils tests where available. Record provenance and select meaningful deterministic regressions without copying slow host fixtures into unit tests.
4. Reproduce discrepancies before changing product code. Keep dialect differences explicit. Exercise filesystem behavior with memory fixtures and preserve cancellation, budgets, and output ownership.
5. Have an independent agent stress the implementation as required by package instructions.
6. Run maintained checks for each atomic fix, deliver to main, and monitor releases through publication. Continue auditing remaining dimensions after each milestone.

## First audit cohort

- Baseline: 214 basic tests passed before edits. GNU coreutils 9.12 path oracle: 105 path/suffix comparisons, no discrepancies.
- Added 47 path option/boundary assertions derived from reviewed upstream semantics, plus `%q` precision regressions through text arguments, raw arguments, and Shell. The maintained focused route now passes 216 tests.
- Independent review exercised 648 argument/format permutations against Darwin Bash 3.2.57, with GNU coreutils 9.12 and Zsh 5.9 spot checks. It confirmed `%q` precision omission and shell fast-path empty-numeric status divergence. Other quoting/locale differences remain to qualify and fix.
- `%q` precision fix reproduced a failing test before changing the formatter. Root guarded ESLint passed. Build and type/consumer qualification remain in progress.

Upstream references acquired 2026-09-30 (GPL-3.0-or-later test sources; semantic cases re-expressed in the existing suite):

| Source URL | SHA-256 of inspected source |
| --- | --- |
| https://raw.githubusercontent.com/coreutils/coreutils/master/tests/misc/basename.pl | `0a4d492022e3dbfc7c8f8a46b2f0ca7139db3098a359ce787755caa3865fd511` |
| https://raw.githubusercontent.com/coreutils/coreutils/master/tests/misc/dirname.pl | `19a37bbf6214835b1d2f1fb6e127d004edb1730c660cdf834c0ddc6f9aba88b5` |
| https://raw.githubusercontent.com/gnu-mirror-unofficial/bash/master/tests/printf.tests | `90ea00cf038950cb3030fd17d1d5c84ce629f7b8835ddeb913009314d22ba1bb` |

Baseline and upstream captures are temporary under `out/`; no completion claim yet. Remaining dimensions include byte paths/suffixes, locale-sensitive quoting, numeric parsing boundaries, cancellation/backpressure, pwd filesystem errors, and shell fast/normal route consistency.
