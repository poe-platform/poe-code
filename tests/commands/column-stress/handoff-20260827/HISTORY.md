# Independent handoff history (pre-fix evidence)

The original seven preparation files at `46e90c80` are immutable. Neither the
40 literal recipes nor any of the 88 native observations is rewritten. This
directory adds a separate authorized execution cohort. JSON is captured evidence;
`history/*.mjs.txt` are exact earlier harness source snapshots, not discoverable
tests or TypeScript inputs. Explicit captures require a new output pathname and
exclusive creation. Canonical `owned-regressions.test.ts` writes no evidence.

## Authenticated author baseline

Full commit `e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64` was archived and extracted
into regular isolated tmp before product execution. Authentication compares every
Git blob, including tab-containing filenames, and verifies the five-file column
digest `62fa56a685eb5a4850b6fa782266a2f5d21b8c9335f4f0f030f4f5767e1bfdb2`.
All 25,348 committed blobs matched before/after execution. Product imports resolve
only into that archive. Seven lock-matching development packages are reused through
explicit read-only links; source paths are not linked. Installed tool versions,
lock declarations, file inventories and before/after hashes are retained. No
dependency installation, private checkout, product native exec, full gate or
performance run is involved.

The isolated build and strict author-scoped TypeScript check pass. All 113 author
tests pass unchanged; native test fixtures are read-only. We do not rerun the
author's native capture or learn independent expected values from its fixtures.
The initial independently authored six regression cases all fail against this
unchanged baseline, and their strict TypeScript check passes.

## Original failures and harness corrections

- Initial archive authentication split a `git ls-tree -z` record at every tab,
  truncating a legitimate tab-containing fixture filename. It stopped before
  product execution with ENOENT. Splitting only the first header/path tab fixes
  the harness, without excluding any archive inputs. Both completed snapshots
  authenticate the entire archive.
- `expectations.json` completes named profile prerequisites from the already
  frozen native records and handed-off README before independent recipe execution.
  Author tests had already run; the metadata distinguishes this from independent
  recipe execution. Original author-suite output is not an expected-value source.
- Initial stress middleware awaited `next()` without returning its CommandResult,
  producing status 1 despite correct nested-invoke bytes. The corrected harness
  returns the awaited result. Original failure bytes/status and earlier harness
  source are preserved in `baseline/stress-baseline*` and `history/`.
- Initial hidden-return characterization called dispose while exec was still
  settling, then awaited its rejecting exec in finally. That harness error masked
  the intended assertion and produced an observed unhandled rejection. The next
  cohort attaches both outcome handlers immediately, records exec/dispose before
  releasing the external gate, and preserves the intended failing barrier assertion.
  Neither version turns a forced release into a cleanup pass.
- N01 and N03 retain failed exact-native stdout assertions. The native oracle pads
  missing trailing fields in these ragged rows, whereas the pre-existing README
  explicitly prohibits padding after a row's last cell. This is a documented
  native/profile distinction, not evidence of column data corruption. No expected
  bytes, fixture input or assertion is changed to make these comparisons green;
  final accounting must qualify them separately from genuine defects.

## Two reproducible column-local defects

1. The column context adapter used object spread. Nonenumerable properties and
   inherited/private-receiver accessors disappeared, including argv and stdout.
   The regression supplies legal frozen CommandContext objects, retains the caller's
   arrays/maps and expects ordinary table output. A local forwarding adapter now
   overrides only owned FS/stdin/signal and reads other properties with the original
   receiver. It does not mutate caller structures or add a regexp path.
2. A caller abort arriving during deferred cleanup after an earlier handled budget
   error was lost: direct invocation returned status 1. The regression exercises
   successful/rejected returns with/without registerCleanup. The local finally path
   now rechecks the exact caller signal after cooperative cleanup, including its
   rejection path. Cleanup still completes before the direct call settles.

The source fix and canonical regressions are committed together, followed by a
new whole committed archive and post-fix replay. There is no live source overlay
or synthetic cherry-picked candidate. Root/shared/runtime changes remain outside
this verifier's write set.

## Remaining Root boundary

ShellInput hides the external iterator's return. Independent actual-Shell evidence
observes both exec and dispose settle before the hidden external return gate is
released. Direct/context-owned and VFS-owned cooperative iterators are distinct
and must still satisfy their barriers. The explicit failing hidden-source assertion
remains in the suite; no all-cleanup-green or public column-subpath claim is made.
The final report and moved packed consumer will carry the same distinction.
