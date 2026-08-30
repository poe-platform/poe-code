# Independent bounded five-source and table review

This is a two-phase independent review, not a whole-product acceptance or a new
comparison corpus. Production is unchanged by this reviewer. Both source closure
markers preceded execution; root separately released the table phase and then
authorized exactly one current-helper compatibility replay.

## Source checkpoint

Actual source/test/dependency snapshot: HEAD label `386196b`, **156 source files**
and **5,434 total hashed inputs**. The worktree was not globally clean. All loaded
snapshot source hashes remained unchanged; this does not validate later moving
HEADs. `snapshot-inputs.json` contains the complete manifest, Node identity,
closure records, dirty/index observations and equal before/after digests.

Two disjoint atomic source fixes are independently verified:

- Patch `96564fe`: `-s`, `--quiet`, `--silent`, suppressed routine progress, retained
  failure/reject summaries, warnings, error status and namespace effects.
- Stat `386196b`: human timestamp fractions derived from the supplied numeric
  milliseconds without Date clipping. Nine digits are a rendering profile, not
  a claim of nanosecond backing storage. Epoch formatting remains unchanged.

Patch source SHA256:
`72bfb60c502ac5bcaf2efa3e0f044b0ab1d89a54293f829d62f011e7c10e82d7`.
Stat source SHA256:
`fab291cc4e5668526fc1247e155f5878e1235d9d95a5096d34bcfa9f022d7f3b`.

### Exact historical five

The exact four patch recipes and one stat recipe from `8e09db9`/`bd2cacb` run
through the original benchmark engine and native functions. All 13 helper hashes
match `0294afb6e690433aed994868e5ed437ecf58ae48`; recipe and complete frozen evidence
bytes are checked, not approximated. GNU patch 2.8 and stat 9.7 use the recorded
executable builds, checked by hash and version before/after.

- Fresh native **5/5** matches frozen full raw observations: **20/20 fields**.
- Current source **4/5 exact rows**, **19/20 fields**. All five match stdout,
  stderr, status and intended file effects.
- Dry-run still has the **native-only empty `tmp` directory**. This remains an
  exact namespace mismatch; no phantom product directory or five-green claim.
- The live benchmark changed six helpers: `capture.mjs`, `common.mjs`, `engine.mjs`,
  `harness.test.mjs`, `native.mjs`, `run.mjs`. Full old/current text and hashes are
  recorded in `five-replay.json`; the new scratch profile was not adopted.

### Targeted checks and retained differences

| Cohort | Independent result |
| --- | --- |
| New quiet tests | 41/41 |
| New human timestamp tests | 40/40: 39 deterministic plus one native cohort |
| Relevant existing patch tests | 270/270 |
| Existing epoch/fraction/width checks | 9/9 |
| Historical SGID archive integrity | 2/2, not SGID execution |
| Scoped TypeScript | `--noEmit`, exit 0 |
| Minimal patch source control | current 3/3; historical 0/3; restored 3/3 |
| Minimal stat source control | current 3/3; historical 0/3; restored 3/3 |

The six negative control failures are semantic assertions on the same existing
cases, not compiler/load errors. Neither source mutation touches live production.

The 19 measured native timestamp fixtures retain **15 exact numeric/output
matches, two rounding-to-native matches and two precision gaps**. Signed,
sub-millisecond and large epochs are covered. Fraction scaling uses the Number's
shortest round-trip decimal representation and nearest-nanosecond rounding,
half ties away from zero; Date only converts whole seconds. Native nanoseconds
not represented in the supplied Number remain unavailable. Birth availability
after negative setters and fractional ctime/birthtime comparisons remain limited.
GNU quiet suppresses one deletion-conflict warning that the product deliberately
retains; this is not exact diagnostic parity.

The original three-digit author fixture is unchanged and still conflicts with
the nine-digit profile. Five selected non-Apple author tests yield **4 pass,
1 profile failure**; the author's separate full **42/43** remains historical.

**Reviewer execution incident:** the first negative-lookahead name filter also
selected the test-file ancestor, unintentionally running the sixth legacy
`/usr/bin/stat -f %z:%N file` size/name check. Initial **5 pass/1 fail** and its raw
bytes remain archived. This violates the requested no-Apple execution restriction;
it is excluded from GNU acceptance and is not concealed. Positive-name selection
then ran only the intended five product tests. No Apple expectation was used by
the exact-five replay or the new quiet/human native cohorts.

## Table phase

Root release text/hash is preserved in `table-verification.json`.

- Existing frozen independent corpus: **104/104**, including all **71 live GNU
  rechecks**. The established **70/71** profile and shared-stdin `comm` status/
  stderr disagreement remain distinct from Node test success.
- Strict prior-dependency **311 is load-blocked**: **291 tests pass**, three
  inherited integration files cannot import removed `forwardOwnedWebDavFetch`,
  and their **20 intended cases do not execute**. The three loader errors are
  not table semantic failures, mutant kills, or a successful 311 run.
- Root then authorized **one current-frozen-helper311 replay: 311/311**. Every
  case source/native input/expectation remains unchanged; only the isolated
  snapshot's WebDAV mock dependency changes to its already-frozen current bytes.
  Full helper texts/diff, old/new hashes, current FS hashes, authorization and
  successful import control are in `table-current-helper-verification.json`.
  This is not unchanged-historical-dependency311 acceptance.
- Scoped no-emit checking and an **isolated** dist build pass. The existing public
  built replay runs the same **71 fixtures in pipeline and redirection modes**:
  70 native-profile matches plus the known `comm` difference in each. This is a
  current replay, not the unavailable historical author's six built checks.
- Prior four semantic table mutation proofs are retained, not expanded/rerun.
  No table/cut/source implementation or new fixture breadth is introduced.

## Archives and reproducibility

Routed archive `916fbb4` and SGID archive `277a635` are separate archival commits,
not source fixes. This review independently verifies **10/10 + 10/10** original
artifact byte matches, all original **18/224 failures**, the old five failures,
and the SGID capture's **97 input hashes**. **Six SGID failures remain unresolved**;
there is no new SGID execution, permission contract, retry or rollback change.
Original author red/calibration evidence is not rewritten.

`execution-logs.json` stores exact stdout/stderr bytes as base64 with SHA256,
including initial failures, corrected selection and both table attempts. This
avoids changing whitespace in raw evidence. `scripts/` records the local bounded
drivers; these require the recorded `/tmp` closure markers, pinned native builds,
and immutable snapshot location, and intentionally refuse duplicate captures.
They are not a new generic benchmark runner.

The five tests in `review.test.ts` verify captured evidence integrity only; they
do not add native/product workloads. Run them explicitly with Node/tsx and use
this directory's `tsconfig.json` with `tsc --noEmit`. Final cleanup/provenance and
owned-path commit details are recorded separately. No native fixture directory,
generated executable, dependency or dist output is committed here.

No full 224 comparison, baseline rerun, original/revised 3758 suite, global tests,
root build, universal GNU/Bash parity, superiority or 72-hour completion follows.
