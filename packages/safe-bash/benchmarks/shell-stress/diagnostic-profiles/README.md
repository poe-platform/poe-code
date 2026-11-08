# Explicit diagnostic implementation profiles

The primary profile is **GNU Bash 5.3.0**, selected as an implementation design
choice, not as a user requirement or a claim of universal Bash compatibility.
The historical GNU Bash 3.2.57 profile remains an active, failing comparison.
Neither profile chooses an oracle, label, or expectation separately by case.

## Fixed cohort and invocation

The unchanged original 105 tests consist of 72 differential fixtures, five
syntax fixtures, 22 virtual resource probes, five process-harness tests, and
one reference-identity test. The unchanged current-gaps 13 tests add 11 fixtures
and two virtual pattern-resource probes. All 88 native-portable fixtures run
under both profiles; no fixture is dropped or rewritten. The five syntax
fixtures now receive exact diagnostic-byte comparisons as well as their old
no-effects/status assertions. Their old tests and helpers remain untouched.

`native-baseline.json` contains two complete stable captures for each profile
with the original `shell-stress` argv0, followed by two complete stable captures
with the globally fixed `shell` argv0 matching `Shell.exec`. It also captures
the original no-write pipeline lifecycle control under every profile, label,
and repetition: 704 fixture children plus eight lifecycle children. Every
capture includes literal scripts, args, sanitized environment, raw byte base64,
file snapshots, PIDs, binary identities, and source/harness hashes. Nothing
normalizes stderr. Different temporary directory names are retained in the
capture metadata; no captured output is rewritten.

Both profiles use `--noprofile --norc -c SCRIPT shell`, PATH `/usr/bin:/bin`,
LANG/LC_ALL `C`, TZ `UTC`, and HOME/TMPDIR equal to an isolated case directory.
The native ceiling is 262144 combined output bytes and a 2000ms deadline.
The intentional lifecycle control uses its original 200ms deadline and 1024
byte ceiling. The unchanged process helper kills detached process groups on
timeout, exit, and close; native temporary directories are removed in `finally`.

The 24 virtual resource probes have no invented native equivalents. They are
an explicit separate active denominator. Five original process-harness tests
also remain unchanged, including their hardcoded historical Bash control.
The profile identity assertion additionally executes that control against the
selected profile, so the modern control is not silently replaced by 3.2.

## Frozen baseline, not a pass claim

`virtual-baseline.json` records stable source aggregate
`96fb0ec0422362d1cbad121660976f33a1019623de36742c5ad8a8284f5fe996`
at revision `33ddb70c75865e3e695cf471b942ab0add98a891`, before source correction.
The shell source was the prior `d0bf4ce` implementation. `BASELINE.txt` gives
the full seven-row diagnostic matrix, two behavioral conflicts, and exact
residuals; it was published to the source author before source changes.

| Baseline comparison | Pass | Active fail |
| --- | ---: | ---: |
| Historical, original argv0, all exact fixtures | 74/88 | 14 |
| Modern, original argv0, all exact fixtures | 74/88 | 14 |
| Historical, fixed argv0, all exact fixtures | 74/88 | 14 |
| Modern, fixed argv0, all exact fixtures | 86/88 | 2 |
| Virtual resource probes | 24/24 | 0 |
| Unchanged historical 105+13 tests | 108/118 | 10 |

The seven reported diagnostic rows already match the modern fixed-identity
profile exactly, including the NUL warning. Their resolution is a profile
correction, not seven invented source fixes. The two original same-unit
substitution behavioral conflicts remain historical failures: 3.2 retains
earlier effects and returns zero; modern and virtual reject before effects
with status 127. Do not weaken parsing to reproduce those historical effects.

The strict modern baseline still fails unterminated-double-quote diagnostic
format and missing-group EOF command context. These must stay active until
source correction. The old tests only checked nonempty syntax diagnostics,
which is why these were not among the prior nine failures. Baseline also
records an independent process-harness cleanup failure, not a dialect waiver:
the descendant inherited-pipe cleanup test reported `kill EPERM` after about
121ms, not a deadline overrun. Repetitions and
final validation must report this separately, without deleting the initial
failure. All resource/identity/harness assertions together were 29/30 at
baseline, giving strict modern 115/118 and historical 103/118. The full original
historical assertions remain 108/118, not a universal pass.

A targeted unchanged `process.test.ts` repetition immediately after baseline
passed all five assertions (zero skips). This does not erase the initial
cleanup failure; full-cohort post-source repetitions remain required.

## Reproduce without altering historical tests

```sh
VIRTUAL_BASH_DIAGNOSTIC_PROFILE=primary-5.3 node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/shell-stress/diagnostic-profiles/*.test.ts
VIRTUAL_BASH_DIAGNOSTIC_PROFILE=historical-3.2 node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 tests/shell-stress/diagnostic-profiles/*.test.ts
node --import tsx benchmarks/shell-stress/diagnostic-profiles/run.ts /tmp/diagnostic-profiles-fresh.json
```

Each selected suite runs 118 assertions: all 88 exact fixtures, one identity
assertion including native lifecycle control, plus the unchanged 24 resource
and five process-harness tests. The default selector is explicitly named
`primary-5.3`; unknown selectors fail. Missing/changed binaries are failures,
not skips or passes. The report runner emits both complete 88-case matrices
and separate 29-test resource/harness transcripts, exiting nonzero for any
mismatch, unavailable reference, resource failure, or changed source. It is
not the root comparator harness and makes no just-bash superiority claim.

The exact installed binary paths and SHA256 values are frozen in the JSON.
Modern is the pre-existing build in
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Historical `/bin/bash` is SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
No new Bash build or runtime dependency is added. These are exact installed
versions, not a claim to have selected the latest release.

## Source and boundary evidence

The existing build provenance is
`/tmp/safe-bash-shell-modern-reference.txt`. Primary GNU source archive:
`https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz`, SHA256
`0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba`.
The extracted `subst.c` NUL branch (around line 6716) drops NUL and warns once;
`error.c` error prolog and `internal_warning` include the execution line.
Their SHA256 values are respectively
`cf96a7f33e7f9281f18c7b02d8840ad2d817f14243dd38377f8090249a7edf85` and
`1437faf7b83170a35abb9381c2d169d66b6c6c925ad7fbec7329a3f02316f402`.
Primary GNU manual evidence was consulted at
`https://www.gnu.org/s/bash/manual/bash.html` and
`https://www.gnu.org/s/bash/manual/html_node/Command-Substitution.html`;
historical discussion is preserved at
`https://lists.gnu.org/archive/html/bug-bash/2016-09/msg00070.html`.
Observed native bytes, not virtual-derived expectations, define the profile.

Public `FsError.code`, errno and path metadata are API contracts, not a shell
stderr serialization protocol. The source author owns narrow shell boundary
tests; contracts, command errors, adapter matrices and root documentation
belong to their respective owners. No regex code stripping, contract weakening,
historical test edits, or blanket matrix reclassification is authorized here.

Preflight initially found generated JavaScript siblings. An eval-parent
resolver probe demonstrated the direct-JavaScript import hazard; it did not
prove TypeScript test contamination. Actual `NODE_DEBUG=esm` tracing of
`virtual-child.ts` showed TS dependencies even while JS siblings existed.
Owners independently cleaned their generated files. The author preserved and
hash-verified nine shell emitted files; this verifier deleted no unowned
artifacts. Fresh source guards and actual-entry load tracing, not the earlier
overbroad inference, establish execution provenance.
