# Four native numeric-syntax fixes

New leaf source fixer, not the CLOSED author or independent reviewer. Scope:
only stream-inspection source/tests. No stress/private case corpus inspected.
No root/public/default wiring, dependency, contract, filesystem, grep, benchmark,
or other command-family changes. The source README/API were read-only; its
historical unsupported-legacy statements are superseded for these three numeric
forms by this addendum, not silently rewritten.

## Preserved baseline and source freeze

Author commit: `4af1b107d4b9449a2c4e7fed467d187448392fd5`.
Original seven-file source manifest:
`57c6e29cc6fae6dce5946dddb211b0cc1bf94ef20badb4286546aeafe1e1d553`.
Original author99/99 result and all original tests/evidence are preserved.
Fixer native fixtures/pre-fix results are in `fixer-numeric-before.json` and
`fixer-numeric-controls.json`; neither is overwritten by verification.

Frozen eight-file source manifest (adds internal `numeric-options.ts`):
`4c52a321778aafad0e41b5858d30746d728306e35e26a44554146a69a05c91a0`.
Manifest serialization: byte-sorted path, NUL, SHA256, newline per file.
All individual before/after hashes are in the validation JSONs. Source commit
`335d2c3` is separate from oracle/harness commit `1ea140b`.
`index.ts`, `shared.ts`, `tac.ts`, and README bytes remain author-identical.

## Behavior fixed

- Expand/fold numeric short options consume the remaining short-option suffix
  as the numeric value. Leading flags work; trailing flags become invalid value
  characters. Explicit option arguments and `--` retain their normal roles.
  Expand accumulates stops; fold validates every width and uses the last valid one.
- Expand stores absolute and relative repeat intervals separately. Zero is an
  unset interval, not a zero-length advancing tab: no explicit stops defaults to
  eight, one stop repeats that stop, multiple stops remain finite. Markers persist
  across comma/blank entries within one specification, but reset across options.
  Thus `2,+0,4` installs relative repeat4 whereas `-t2,+0 -t4` has finite stops2,4.
  A nonzero interval cannot be reassigned, and nonzero absolute/relative intervals
  conflict. Adjacent zero, marker, separate-option, and rejection cases are retained.
- GNU strings numeric options are selected after ordinary options, with the final
  legacy selection overriding valid `-n` regardless of order. Zero in an earlier
  ordinary `-n` still fails. Leading-zero legacy lengths use octal, and uint32
  overflow/sentinel values fail before input. GNU2.44's deferred getopt index and
  operand permutation behavior are retained: `data -5` diagnoses `ata`; `-5 data`
  works, and `-3 -5a` selects the previous numeric argument. Program-path-dependent
  native negative diagnostics use explicit shorter virtual utility diagnostics.

The four reported argv/stdin bytes now match native status0, stdout bytes, and
empty stderr. Original misleading reviewer label `expand-invalid-54` was not
used to waive the native-success case. No independent acceptance is inferred.

## Native provenance and comparison scope

GNU-on-Darwin arm64, Darwin25.4.0; not GNU/Linux. Fixture executions use
`LC_ALL=C LANG=C TZ=UTC PATH=/usr/bin:/bin`. GNU9.7 directory:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src`.

- expand SHA256 `158dccaca888f3187291f4f4ede9b3715ccee15e8e441f82030dc09d25a2648b`
- fold SHA256 `8cfe2de684b57136dcb7040d529289b610f4f15a4f8696cded679d56a5361559`
- strings GNU binutils2.44:
  `/tmp/safe-bash-gnu-strings-20260827-YJqPHf/build-system-zlib/binutils/strings`
  SHA256 `90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f`

Binary identities are checked before/after the final71 native captures. Provider
source hashes are preserved in `fixer-order-exploratory.json`; providers were
read-only, with no build/install. Native file fixtures use unique owned tempdirs
removed in finally. Early43 stdin-only exploratory calls and six console-only
ordering probes ran without fixture creation; six ordering probes were repeated
in isolated directories with absent operands and recorded separately. Exploratory
calls and repeated captures are not additional acceptance coverage.

Primary manual lookup via web.run was performed for GNU expand compatibility
syntax and GNU binutils strings minimum-length options. Manuals are contextual,
not substituted for the pinned versions' executable/source behavior. Primary
pages: GNU coreutils `manual/html_node/expand-invocation.html`, GNU coreutils
`manual/coreutils.html`, and sourceware binutils `docs/binutils.pdf`.

## Harness corrections and non-overlapping counts

Initial68 fixture capture is immutable. One tentative assumption that strings
`data -5` succeeds was contradicted by native; the corrected71 profile changes
only its intended error field (same argv/input/files), and adds three adjacent
ordering fixtures. Raw initial native/pre-product results remain available.
Initial77-test attempt:4 pass,72 fail,1 live skip; it also had harness assumptions
about DirectoryEntry names and exact quota diagnostic prefixes. These were fixed
to the actual typed API/diagnostic without weakening namespace or byte checks.
The corrected pre-source80-test run is retained raw:8 pass,72 fail,0 skips.

Final numeric suite:82 tests =71 native fixtures +1 live replay test +8 direct
cancel/budget tests +2 actual-Shell tests. The71 fixtures are31 expand,16 fold,
24 strings;46 exact successful status/stdout/stderr comparisons and25 negative
status/stdout comparisons with separately exact-asserted virtual diagnostics.
Native negative stderr bytes remain recorded; full negative stderr parity is
not claimed. Tests assert unchanged VFS names and file bytes.

Original author suite is run separately:99/99 =42 contracts +5 integration +38
primary-native +14 GNU-strings tests, with both live controls enabled. Its52
native observations and scoped profile limitations stay as originally reported.
Do not add replay calls, the live wrapper tests, or overlapping original/new
fixtures into a distinct workflow denominator. No stress/private tests were run.

## Reproduction and remaining limits

Run from the repository, with the pinned binaries still available:

```sh
node --import tsx tests/commands/stream-inspection/fixer-verify.mjs tests/commands/stream-inspection/evidence/fixer-validation-replay.json
```

The verifier refuses to overwrite prior evidence. It runs scoped strict noEmit,
numeric82, original author99 live, and owned whitespace checking; records exact
commands, runtime, timestamps, shared dirty status, and before/after source/API
hashes; checks zero runtime dependencies. No main build emission or default root
test suite runs. `fixer-validation-first.json` and `fixer-validation-final.json`
record the two successful fixed-source validation passes separately.

Source module remains opt-in only; no installed-package export proof or default
integration authorization is implied. Existing resource limits and byte/C-locale
profiles remain: no full GNU flags, Unicode width, object-section strings, 64-bit
unsafe-JavaScript-number range parity, superiority, global gate, duration, or
72-hour completion claim. Independent reviewer replay must occur after CLOSED.
