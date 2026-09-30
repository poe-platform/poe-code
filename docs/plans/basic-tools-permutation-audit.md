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

## Byte paths and fast invocation cohort

- Fixed empty numeric operands bypassing errors through `tryFastPrintf`. Reproduced status loss in ordinary Shell calls, `-v`, loops, and command substitution; the regression checks eight integer formats through all four routes and preserves successful omitted operands.
- Fixed basename/dirname replacing opaque pathname bytes and falsely removing distinct decoded suffixes. Regression coverage includes positional, separate/attached short, and attached long suffixes, multiple outputs, zero terminators, and Shell variables populated through command substitution.
- Independent candidate comparison: 1,250/1,250 cases matched GNU coreutils 9.12 (Darwin, `LC_ALL=C`), covering 48 paths, six suffixes, four suffix forms, dirname output modes, and duplicate decoded identities. Six independent cancellation/backpressure controls passed and are now retained in maintained tests.
- Current basic suite: 220 passed. Adjacent eight-file run before adding the two stream tests: 532 passed, 17 skipped, zero failures. Skips are not counted as passes. Guarded root lint passed after the final test additions.
- The broad typecheck reproduced two lazy-command fixture type errors; corrected the sink arity and normalized the handler result to a Promise. Its three focused tests pass. Standalone consumer staging also requires outputs beyond the selected Safe Bash build closure; a normal full build is in progress before retrying qualification.
- Local commits exist; remote delivery and publication are not yet verified.

## Additional printf qualification

- Independent classified cohort: 1,956 comparisons (1,380 integer formats/operands, 576 string/escape/quote/reuse cases), zero oracle errors. All 232 differences were accounted for: 138 GNU rejections of Bash flags, 54 GNU bare-quote numeric errors, 24 Darwin string-padding differences, and 16 old Bash 3.2 empty `%b` padding differences. Newer upstream source confirms the candidate's empty `%b` padding behavior. This does not mean every GNU or Bash input is supported.
- All 234 eligible fast-helper cases matched handler bytes and status after the empty-numeric fix.
- Reproduced and fixed unnecessary `%q` escaping of safe punctuation and noninitial hashes/tildes. The regression also checks contextual tilde protection and actual Shell eval roundtrips, so relaxing escaping cannot silently alter arguments. Current basic suite: 221 passed; guarded lint passed.
- Quoting rules reviewed from https://raw.githubusercontent.com/gnu-mirror-unofficial/bash/master/lib/sh/shquote.c, SHA-256 `27a2be058864e9ee7d3aa6a3ec9f312ea153946532fdc488a1fbf4d0140876bd` (GPL-3.0-or-later), using printf's flags=3 semantics. System Bash 3.2's leading-tilde output differs from the newer source and is not used as that expectation.
- Full workspace builds completed, but the root build suffix encountered a sandbox denial creating tsx's IPC socket. Retrying the maintained normal build with the required execution permission; no route or gate was replaced.

## Current Bash oracle and remaining findings

- Normal `npm run build` passed after the permitted retry, including root schema generation and bundle stages. Source typechecking passed; public consumer qualification is still running.
- `%q` independent ASCII check: 2,856 context/width/precision cases; 2,845 matched Bash 3.2 exactly and 11 contextual tilde differences matched the newer upstream source. All 476 complete quoted values roundtripped in both native Bash and Safe Shell.
- Obtained an isolated Bash 5.3.20 oracle from official Homebrew Sequoia bottles. No global tool installation or product native fallback. Bash bottle SHA-256 `753bdd9943047829a2f8469ed2d29fc71d0de5572df2a6d0e7b3f30be71ae937`; executable SHA-256 `a371777caf6cae7af43b2f61d94bcc409eb9cfdc02c97e0eaf71c0ed60e7b761`. Matching Readline bottle SHA-256 `461763fa21c050a59e5bbceedf67dcacf24e4aa4604490d73f0c9fa0f40e7fe5`; extracted readline/library hashes `3677cafdb5b027d03e45ffb903d555f27f0266767cd6c6676342377c1195aa4d` and `bf1a8ca341d0c5d657be58d55048121ff475ebe9811475c59356d3930d41e402`. Library search configuration is scoped to the audit launcher.
- Added `SAFE_BASH_TEST_BASH` to the existing native comparison fixture, retaining `/bin/bash` as its default. The maintained printf-variable test route passed 126 tests with zero skips against Bash 5.3.20, including the 17 Bash 5 comparisons unavailable on system Bash 3.2.
- Confirmed an additional shared escape parser defect, not yet fixed: unknown backslash escapes before supplementary Unicode scalars are split into replacement characters on text-based echo routes. Independent cohort: 960 comparisons, 240 failures (72 each against Bash/GNU for direct text echo; 96 through shell, loops, redirection, and command substitution). Raw-byte echo and all printf variants passed. This remains required audit work.

Upstream references acquired 2026-09-30 (GPL-3.0-or-later test sources; semantic cases re-expressed in the existing suite):

| Source URL | SHA-256 of inspected source |
| --- | --- |
| https://raw.githubusercontent.com/coreutils/coreutils/master/tests/misc/basename.pl | `0a4d492022e3dbfc7c8f8a46b2f0ca7139db3098a359ce787755caa3865fd511` |
| https://raw.githubusercontent.com/coreutils/coreutils/master/tests/misc/dirname.pl | `19a37bbf6214835b1d2f1fb6e127d004edb1730c660cdf834c0ddc6f9aba88b5` |
| https://raw.githubusercontent.com/gnu-mirror-unofficial/bash/master/tests/printf.tests | `90ea00cf038950cb3030fd17d1d5c84ce629f7b8835ddeb913009314d22ba1bb` |

Baseline and upstream captures are temporary under `out/`; no completion claim yet. Remaining dimensions include byte paths/suffixes, locale-sensitive quoting, numeric parsing boundaries, cancellation/backpressure, pwd filesystem errors, and shell fast/normal route consistency.
