# Independent current kernel/invocation acceptance

Measured August27,2026,05:01:22–05:02:45 UTC after the explicit READY and source
lease relinquishment for `f1bb98b4ec8fd9cc198959e85f96e38880e72243`. This is
additive evidence: all18 baseline3243c5a files and original cases, native
oracles and harnesses remain byte-identical. No source or sibling file was
edited; no expectation was updated to make a failure pass.

## Measured before and after

| Cohort | Immutable3243c5a baseline | Current f1bb98b | Meaning |
| --- | --- | --- | --- |
| Expanded36, GNU5.3 |29/36|**30/36**|One previously failing scalar-substring control now exact|
| Expanded36, historical3.2 |28/36|**29/36**|Same one-row improvement; historical losses retained|
| Expanded10 host contracts |10/10|**10/10**|Every complete host observation unchanged|
| CORRECTED72 |72/72|**72/72**|Original migrated assertions,57 differential plus15 host rows|
| Whole raw57, GNU5.3 |52/57|**52/57**|Every current raw tuple unchanged|
| Whole raw57, historical3.2 |50/57|**50/57**|Every current raw tuple unchanged|

Product36+10 and CORRECTED72 ran **exactly once**. There were no skipped,
cancelled, todo, timed-out, overflowed or rescued product rows. Only
`parameter-existing-controls` changes among36: now status0, stdout bytes
`6:bca:default:set`, empty stderr and the same unchanged namespace entries,
matching BOTH native profiles. Baseline status2/no stdout/unsupported-expansion
diagnostic remains intact. The other35 observations, all57 invocation tuples
and all10 host observations are byte-for-byte unchanged from baseline.

`ACCEPTANCE_ROWS.md` and `acceptance-rows.json` retain all15 rows from the
original unresolved union, with **baseline, current, primary and historical**
exact tuples and effect maps. The newly resolved row stays visible;14 still
lose at least one whole profile. No environment order, stderr, mode, status,
source name, native profile or denominator is normalized.

## Remaining current losses

| Expanded36 primary loss | Current versus both native profiles | Classification |
| --- | --- | --- |
| header-execute-no-read |126/no effects throughout; current adds `line 1:`|Diagnostic context only, not permission bypass|
| env-single-kernel-argument |Current126/no marker; native0/marker=`should-not-run`,0644|Actual optional-interpreter-argument capability gap, with Darwin launch/policy qualification; not a pass|
| env-injection-text |Current126; native127; no command/body injection or new effects|Observable allowlist/error-status difference, not merely cosmetic|
| env-missing-target |Current126 unsupported; native127 missing target|Observable allowlist/error-status difference; unresolved|
| env-unsupported-interpreter |126/no effects throughout; unsupported versus bad-interpreter wording|Contained unsupported-interpreter policy/diagnostic difference|
| parameter-substitution-order |Exact `XbX`, status0, empty stderr, `patternreplacement` bytes;0666 versus0644|Unclosed filesystem creation/umask policy, not expansion-order corruption|

Invocation57's five primary losses remain `path-only-denied-126`,
`path-missing-127`, `path-unsupported-shebang-policy`, `path-binary-policy`,
and `path-invalid-utf8-policy`. The first two retain correct status/effects;
native `$0=outer` plus one injected role-prelude line differs from virtual
default `shell` and original unprefixed source. The next two retain126 and no
effects but deliberate containment diagnostics differ. Invalid UTF-8 remains
explicit126 source rejection versus native byte-command lookup127; this is a
real raw policy loss, not an authorization to run ambient host binaries.

Historical-only losses remain expanded `header-noexecute`, invocation
`stdin-eof-syntax-prior-effects`, and `child-environment-isolation`. Primary
matches all three; historical diagnostics differ, with status and effects
preserved. No current36/57 loss involves registry-kind classification. The
separate seven's truthful `command` versus native `builtin/file` distinction
and0/7→3/7→6/7 history remain untouched and **were not rerun**.

## Fresh complete native evidence

Both complete36 and complete57 cohorts were freshly captured once under
**each** pinned profile:186 native case executions, plus the original profile
controls. All36×2 and57×2 raw tuples match the immutable frozen oracles and
baseline native captures. The57 source hashes, stdin bytes and rendered
fixtures also show zero drift. New captures confirm, never replace, expectations.

- Primary executable: `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`,
  GNU5.3.0(1)-release; SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical executable: `/bin/bash`,3.2.57(1)-release; SHA256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
- Actual `/usr/bin/env` is Apple's Darwin binary, SHA256
  `9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776`.
  This is not GNU env or a GNU/Linux kernel capture.

Original launch roles remain exact:36 OS argv0=`bash`, `$0=shell`, fixture role
symlinks and declared canonical native cwd→`/fixture` projection;57 OS
argv0=`bash`, `$0=outer`, the original one-line `exec -a bash/sh` role functions,
literal PATH=`base` and rendered `{{bash}}` fixture mapping. All actual oracle
environments retain original scrubbed PATH/HOME/C locale/UTC. Raw bytes,
arguments, cwd, effects, versions and hashes remain in the new native artifacts.
Original snapshot boundaries are not broadened into unmeasured FS guarantees.

Fresh controls again prove GNU5.3 parent/env-child with **Bash3.2 direct
`/bin/bash` child**. Historical parent/env/direct children are3.2. Native
optional-argument behavior is Darwin evidence, not a guessed universal kernel
rule. No per-case profile or role substitution was introduced.

Only the native **capture harness** receives host PATH to locate its saver/git;
every actual oracle receives the original scrubbed environment. This uses the
disclosed baseline recovery from the outset. There is **no acceptance saver
failure or retry**. The initial baseline saver failure and its recovery remain
immutable, not retrospectively called a successful first attempt.

## Source, import and compiler guards

All10 current/committed shell files match f1bb98b before/after every phase.
READY and its exact bytes/hash are retained in `acceptance-ready-proof.json`.

- Runtime SHA256:
  `e8f1edb842d04498050d314091269974df157b11ab13cabba41d9c84a0191538`.
- Parser SHA256:
  `feb6cbb2f03ec0c409adeb816bec506788fb3014a23c8dd02f4002362dc4b9f2`.
- **49/49 capture guards valid**:2 native parents,46 product rows,1 whole72
  runner.135 actual aggregate source imports and34 focused source imports are
  traced into child processes and match prelisted before/load/after hashes.
  All135 unique actual source imports also equal committed f1bb98b bytes.
- 31 immutable inputs cover the18 original evidence files, frozen oracles and
  original actually loaded test/harness inputs; each phase preserves their
  pinned baseline hashes. No hook was bypassed and no invalid run retried.
- Per-phase input drift is zero. Three **unimported foreign test files** appear
  between phase boundaries; their exact endpoint differences are retained in
  `acceptance-audit.json`. Six stable stream-inspection source files are outside
  commit f1bb98b and never imported by these product runs. They are explicitly
  listed, not ignored or presented as committed source. HEAD/index moved with
  foreign work; this is **not clean aggregate/tree certification**.

| Guarded noEmit phase, once | Exit | Prelisted/actual inputs | Fixed-input drift / unlisted inputs |
| --- | --- | --- | --- |
| Global |0|1117/1117|0/0|
| Build configuration |0|308/308|0/0|
| Benchmark configuration |0|417/417|0/0|

All three compiler guards pass with no diagnostics, missing inputs or source
anchor mismatch. Compiler inputs/configs are hashed before/after and actual
`--listFiles` sets must match pre-enumeration. TypeScript reads source; it does
not execute product modules, so compiler input evidence is not mislabeled as
runtime import evidence. These are **noEmit checks**, not emitting builds or
full test-suite runs. Foreign current inputs are included and qualified; no
unrelated repair, relaxed flag or retry occurred.

## Read-only source review and separate evidence

The feature commit changes only parser/runtime production files: scalar
substring metadata/parsing, arithmetic delimiter handling, bounded runtime
slicing, multi-digit positional parsing and zero-spelling `$0` lookup. The
arithmetic helper remains unchanged. Substring evaluation reuses existing
arithmetic variables, cancellation and expansion limits rather than creating a
new Shell/budget. C-byte slices that cannot be represented as valid UTF-8 are
explicitly rejected; array/list forms remain outside this increment. No public
contract, core/FS API, lifecycle, environment, shebang or creation-mask change
is attributed to this source commit. The passing original host observations
retain dispatch-budget/noreset, cancellation identity, input cursor/provenance,
permission-before-effects and child-state controls; they do not establish
universal substring/budget coverage.

To avoid needless duplication on the identical source, the author's105 TAP,
parser132, source/eval86 and current-shell44 were **not rerun here**. Their
reports are referenced by hash, not added to independent denominators. Author
105 includes two unsupported-error characterizations and one bounded-child row;
it is not105 native matches. Author raw main primary48/50 C and50/50 UTF8 plus
four supplemental rows remain the separate reported evidence.

Different verifier acceptance `8fe9473846237260e1519bc621fc36d2fcf37c40`,
on frozen29a6795 cases, is also referenced rather than duplicated: GNU C20/24,
UTF8 23/24; historical15/24 and18/24; host2/2. Its three C byte-split failures
remain actual failures. Its fourth primary loss, invalid-octal offset08 versus
token8/error wording, has matching stdout/status/effects and is attributed to
the unchanged arithmetic helper, not fixed or waived here. All96 of that
reviewer's file-effect/mode observations match; that does not close this
cohort's new-file0666-versus0644 gap.

## Scoped closure and next capabilities

The exact frozen scalar substring defect is closed **for this original row**,
with no observed regression in the unchanged surrounding cohorts. This is not
full scalar-family, shell, invocation or kernel parity.

Concrete remaining work for ROOT to scope separately:
1. Optional env-shebang arguments **and real `errexit` behavior**, not merely
   accepting `-e` without its semantics; retain literal arguments/no injection.
2. Explicit decisions for missing env targets/allowlist126-versus127 behavior,
   without ambient host fallback.
3. Coherent virtual umask creation/inheritance across shell and all commands,
   rather than a mode-only patch to one fixture or one redirection.
4. Byte-valued substring fragments in C and documented array/list forms,
   without hiding unsupported rows behind successful-error characterizations.

Accepted accounting, old9 diagnostic/profile work, five CUSTOM firstread
requirements, independent seven, BOM/jq and broad suites were not rerun or
closed. All320 recorded acceptance/compiler child process groups are absent;
temporary native/trace directories are removed, with no SIGSTOP or watcher.
Only additive owned evidence is committed, foreign staging preserved. Stop
and relinquish; no further source work or polling is implied.
