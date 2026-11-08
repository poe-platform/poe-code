# Frozen holdout / current-source checkpoint

Freeze commit `dba5df8693f6d9d15feb0aa039985d91e2ea7b3a` contains36 native
definitions,10 host assertions, and both complete native captures. No source
author's new tests or expectations were read. Primary GNU5.3 remains fixed;
historical3.2 is whole-cohort, not a case-selective fallback.

## Observed results

`pre-ready-harness-recovery.json`, August27 2026 03:14:42–03:14:53 UTC:
- PRIMARY exact29/36; HISTORICAL exact28/36; host contracts10/10, separately.
- All46 actual import guards stable:130 source paths, one unique source map
  `11796b4c4d2cb52b2562df6af065d3fd522a8b77708a2f95c54ea76b271d710c`.
- Runtime `e8c61eb96c76999b0ac61a956312fce7d2e6077f1b2c55fcd9c15d4d50b40123`;
  parser `28492059750ba7f11fad563dfc03dba049f232b3f2212186cf3553e4559ae905`.
  These were dirty author work, NOT accepted954f230, not a committed READY
  snapshot, and not final acceptance. No blind foreign-drift retry occurred.
- Headerless argv, PATH, cwd, export/local separation, child status/state,
  functions, empty executable, symlink, nonexecute denial, explicit Bash read,
  and PATH search past a denied candidate match primary. Basic env bash/sh,
  tab whitespace, literal argv and child isolation match.

Seven primary exact losses remain, none skipped or waived:
1. Execute-only/unreadable script: correct126, no effects, extra `line 1:` in stderr.
2. `env bash -e`: native Darwin succeeds and writes marker, virtual rejects126.
   This is a platform/unsupported argument boundary, NOT Linux semantics.
3. Injection text: native127 vs virtual126/unsupported; neither executes injection.
4. Missing env target: native127 vs virtual126/unsupported, no body effects.
5. Missing absolute interpreter: both126, differing human diagnostics.
6. Pattern/replacement command substitution: stdout `XbX`, status0, empty stderr
   and `patternreplacement` marker bytes match. File creation mode differs:
   native0644 vs virtual0666. This is not an expansion-ordering failure.
7. Existing-parameter control includes substring `${VALUE:1:3}`: expected
   `6:bca:default:set`/0, actual empty stdout/parser diagnostic/status2. No
   earlier-source control was rerun; do not claim a new regression or broaden
   the authorized removal/replacement fix into substring implementation.

Full exact bytes/status/effects and classification are in `findings.json`.
Historical additionally differs on noexecute diagnostic (`line 1:`); native
primary/historical35/36 tuples agree. Neither profile loss denominator changes.

## Transparent harness recovery

The first product capture `pre-ready-current.json` remains immutable. Its source
hash guards are valid but22 observations were destroyed by a verifier snapshot
bug: FileStat.mode type bits were passed to MemoryFS.chmod AFTER execution.
Its13/36+10/10 is therefore NOT a valid product aggregate. The verifier alone
masked permission bits during the after-execution snapshot, then performed ONE
explicit recovery into a fresh artifact. No case, script, expected bytes, mode,
denominator, native capture or production code changed. The frozen host checks
were also rerun unchanged as part of the complete46 recovery. No further retry.

All source/command/depth/output host checks reached intended tick dispatch and
typed budget errors. Output witness observed three ticks under10 bytes, without
asserting exact sink charging or closing the separate doublewrap policy issue.
Cancellation kept the exact caller FsError object, no body tick; binary input
cursor consumed00ff then41 and supplied/default origin remained distinct.
Hostexec stubs recorded zero calls. No actual host tool is exposed to product.

`validation.json` records current runner/helper hashes, syntax checks, endpoint
drift, staged-path observation, and child-group absence. There is no global
typecheck, build, full suite, clean aggregate, full native/kernel/Bash parity or
superiority claim. No source patch, new dependencies, SIGSTOP or waiting on
READY. Root resumes acceptance only after the author handoff; all immutable
losses and separate historical/open requirements remain open.
