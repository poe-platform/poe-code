# Independent two-pin review — August 27, 2026

## Verdict

**The two-pin migration is authenticated and its guards work, but the frozen
candidate is not approved as a fully passing test-control checkpoint.** Three
of its six new binding controls contain incorrect exact exception-message
expectations. They fail on the recorded Node22.22.2 toolchain even though the
underlying hash guards correctly reject the mutations. No candidate or source
file is changed by this reviewer. ROOT must route that test-only defect back
to the author; this review does not silently repair or waive it.

Candidate: `e192662d2fda90104ab5a7e59c9b5c88bf5838c3`. The separate author thread is
`01a04314-dda5-7233-a841-0bc7a1533906`, identified from the header of
`/tmp/safe-bash-diagnostic-pins-author.log`. No author execution result is adopted.
Only committed candidate content is used; concurrent author output is not read.

| Execution | Tests | Pass | Fail | Meaning |
| --- | ---: | ---: | ---: | --- |
| Whole explicit primary GNU5.3 | 89 | 89 | 0 | 72 differential +5 syntax +11 gaps +1 identity |
| Whole explicit historical Bash3.2 | 89 | 75 | 14 | 67 differential +0 syntax +7 gaps +1 identity pass |
| Frozen candidate binding controls | 6 | 3 | 3 | Three incorrect exception-message assertions |
| Mutated current differential driver | 89 | 0 | 89 | All fail in before hook; expected negative guard result |
| Mutated current gap driver | 89 | 0 | 89 | All fail in before hook; expected negative guard result |

All test runs have zero skips, cancellations and TODOs. The two whole-profile
runs each have zero hook failures and a passing original identity/lifecycle
test. Their logical behavior corpus is the same88 fixtures run twice, not176
unique fixtures. Their2 identity tests are separate from those176 observations.

Two additional guard-only programs pass: current bytes accept current/reject
historical binding, and original bytes accept historical/reject current binding.
These programs execute neither native nor product cases and are not added to
the89-test denominators. The178 mutant hook failures are **not178 product bugs**.

## Full-byte and history authentication

Historical seal: `eb602376d11f9d19cd22864027fe51f564944381`.
Sibling-driver migration: `4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9`.
Independent prior audit: `8cafed9bff7a8df1cf49b4ff4ef3ee021229ae3c`.

```text
tests/shell-stress/differential.test.ts
old 985d6e578841af649bbf4469fa69c48634070077baa9ecb85b60429da085e118
new 59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32
old Git blob b87954f4568bfe24c1ca757e5f0a6eb86166dc1c
new Git blob 05d6995613544dbd4d2c43ae4390523db16aef6e

tests/shell-stress/current-gaps/compatibility.test.ts
old 93f4d8dd5938ddba1464b126e5aec00c5304eacbd7470768e550301837dc4fa6
new ddf404839fae525ae5ebc6d4241c09be307b4ab9359c099d7f7dac67e2c975ca
old Git blob 4255873f5cbb306a8b97e19034d16b4e2dfdcf0b
new Git blob 4c8d05d60f529f2bd0460a78cf49d356b946c51c

benchmarks/shell-stress/diagnostic-profiles/native-baseline.json
0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3
```

The reviewer independently reads complete old/new Git blobs, checks the
migration parent has the old bytes, and checks the frozen candidate has the new
bytes. `authentication.json` retains both full driver texts and the entire
driver diff, independently matched to Plato's committed diff. Explicit text
transform checks prove that only the named oracle imports and test labels
change; fixture loops, test body assertions and the identity control stay exact.

This is **not semantics-unchanged provenance bookkeeping**. The sibling drivers
formerly called live native Bash3.2 with command name `shell-stress`; they now
reference authenticated frozen GNU5.3 observations with uniform command name
`shell`. The88 canonical fixture/source/stdin/argv and native tuple crosswalk
is independently checked against the original primary `shell` capture. The
diagnostic suite does not execute those sibling drivers: it continues its own
explicit whole-native-profile replay with uniform `shell`, then compares current
product against that profile's unchanged historical tuple. No per-case oracle
selection is introduced.

Exactly2 of14 historical test/helper bindings migrate for the current guard.
The other12 remain historical. Expected current hashes are fixed literal values
for the two exact paths, not hashes derived blindly from current worktree bytes.
`validateFrozenProfile` keeps historical binding behavior; current compatibility
uses `validateCurrentProfile`. Both retain fixture/native/lifecycle checks and
now verify the literal original capture hash before using its source-pin map.
The diagnostic compatibility file differs only in the imported/called validator;
the complete native runner and lifecycle-function suffix is unchanged.

The original89 hook failures are preserved, not relabeled as behavior failures
or re-executed. The reviewer decompresses the authenticated original report,
rechecks all89 byte ranges/names/hook-failure markers against the independent
audit, and matches the candidate's byte-preserving excerpt. No historical native
artifact or original failure record is rewritten.

## Candidate control defect and negative evidence

`pin-migration/binding.test.ts:43` supplies an exact `{ message: prefix }` to
`assert.throws` for both changed drivers; line74 repeats that pattern for the
unchanged fixture. `current-binding.ts:31` rejects with `assert.equal`, whose
actual recorded message includes the prefix **and** the actual/expected hash
diff. The nested comparison consequently fails. For the differential driver:

```text
expected message:
Current fixture/helper binding changed: tests/shell-stress/differential.test.ts

actual message:
Current fixture/helper binding changed: tests/shell-stress/differential.test.ts
+ actual - expected

+ '876d8c2f6742bbedb4cc954b35b107ba09b0e756c657ef9b6ca26bfb2e19bf49'
- '59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32'
```

The full raw TAP retains the equivalent two other failures. The positive
current-binding control, old-driver replay/opposite rejection control, and
historical-rejects-current control pass. No status or diagnostic is changed to
make the faulty controls green, and no product source defect follows from them.

The initial reviewer parent records this3/6 result and stops before its remaining
phases. That artifact is immutable. `remaining.mjs` performs only the previously
unexecuted requested mutant/guard phases in a second regular candidate copy;
**neither89-profile suite nor the six-control suite is retried**. The second
artifact binds the first artifact's SHA256 and states this distinction.

Each whole89 mutant run appends one newline to exactly one archived sibling
driver. Both return status1 with89 `hookFailed` results and the precise offending
path. Actual process/module traces show **zero native launches, zero virtual
case launches and zero public product-index loads** in either run. No case
effect occurs. The copied drivers are restored; full historical guard replay
then verifies the original bytes, and the two profiles are not interchangeable.
Only owned regular scratch copies are mutated; all live candidate files remain
untouched.

## Strict historical losses

All88 fresh native case stdout/stderr/status tuples per profile match their
respective frozen capture: **176/176 native case tuples**. Each native case also
passes the unchanged full file-snapshot assertion before the product executes.
The trace does not separately emit native filesystem snapshots; that portion of
the proof remains the unchanged suite assertion, not invented trace data.
All176 actual product observations are independently decoded from traced child
output, including relative file bytes and namespace effects, in `observations.json`.

GNU5.3 has88/88 exact behavior tuples. Historical3.2 has74/88 exact behavior tuples
plus its passing identity control. Of its14 strict losses,12 differ only in
stderr text/bytes; two also differ in status/effects, and one of those differs
in stdout. The two semantic profile differences are:

- `nested-substitution-syntax-error-does-not-prevent-earlier-effects`: historical
  status0 and `marker=touched`; current/primary status127 and no marker.
- `prevalidation-prior-output-and-file`: historical stdout `beforeafter`, status0
  and `marker=marker`; current/primary empty stdout, status127 and no marker.

Their exact source programs, every field of native/current tuples, and all12
other diagnostic losses remain in `observations.json`. No change is described
as14 newly introduced product bugs or14 waived passes. This two-pin test-only
candidate introduces no product source change and does not erase historical
dialect differences. No case, expectation or golden is rebaselined here.

**Mode limit:** the original `Observation`/`Snapshot` model checks file bytes and
types, not mode bits. This review neither adds a mode waiver nor claims mode
coverage; the prior supplementary40-mode discussion is not changed or rerun.

## Source, execution and cleanup provenance

All execution uses237 authenticated regular candidate inputs, including the
complete213-file source tree and unchanged candidate package/config files.
`virtual-child.ts` imports the broad public `src/index.ts`; no internal subset,
dist shortcut, root source overlay or private checkout is used. The source
revision is the candidate commit, not the moving live HEAD.

```text
src/shell/runtime.ts
2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b
src/shell/parser.ts
10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e
package.json
8e2f368f83680bf443335e7347328abe7d74d6b23768f283b3a8b0970aca5427
tsconfig.json
f473dbe2230f833bbd374f6d211e843da377973fa96ad0eb38b6b5740dd18027
```

Regular copied tools: tsx4.23.12, esbuild0.28.2 and its Darwin-arm64 binary,
60 files total, with installed/copy/endpoint hashes. Node22.22.2 SHA256 is
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
No dependency installation or symlinked live source is used. The six frozen
controls alone access the original **read-only Git object database** using
explicit `GIT_DIR` to read the fixed historical commit; their executed tests,
helpers and tools remain candidate copies. Whole-profile helper revision strings
are empty outside Git; the independent commit/blob evidence supplies identity.

Native prerequisites, version/identity controls and lifecycle checks retain
the original C environment, argv, input, limits and cleanup semantics:

```text
GNU Bash5.3.0(1)-release, aarch64-apple-darwin25.4.0
/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash
8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
GNU Bash3.2.57(1)-release, arm64-apple-darwin25
/bin/bash
35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3
```

Each complete profile launches88 native cases, one version control, one bounded
lifecycle control and88 fresh virtual cases. `/bin/cat` and `/usr/bin/head`
identities are recorded as host prerequisites, not inferred GNU/Linux utilities.
Scrubbed Node-child environments receive only the disclosed import-trace preload
and cache setting needed to retain actual child import proof. Native environments
and all shell fixture/command arguments are checked unchanged.

The first run is `2026-08-27T12:14:24.207Z`–`12:15:24.499Z`; remaining requested
phases are `12:17:24.075Z`–`12:17:25.940Z`. Each whole profile records17,720 actual
module loads including88 public-index loads. All seven phase guards pass,
including before/load/after file hashes and archive-only import identities.
Compressed traces retain raw native/product argv, cwd, env, input/output bytes,
status, signals, process IDs and module URLs. Both complete archive endpoints
match their initial candidate bytes after scratch mutations are restored.

Foreign live HEADs differ between phases (`e0aa2d23...` then `026e20cf...`) and
foreign package/config/staging work exists; individual worktree-versus-commit
hashes and global status endpoints are recorded. No clean-live-aggregate claim
is made. All356 recorded detached native/virtual case/control process groups
are absent, as are all top-level owned runner groups. Both owned external
archives are removed after durable capture; no foreign signals or cleanup occur.

Read-only reviewer integrity checks pass7/7. This validates the retained
**failure** evidence; it does not turn the candidate's3/6 controls into6/6.
No global typecheck, build, full gate, kernel, cleanup-pin, pre-env-S cohort,
accepted accounting or other owner's suite is executed or modified.

Reproduction uses the one-shot `review.mjs` followed by `remaining.mjs` only
for its documented unexecuted phases, in a disposable checkout with new output
files absent. `analyze.mjs` decodes stored trace without executing cases;
`node --test tests/shell-stress/diagnostic-profiles/pin-review/integrity.test.mjs`
checks the committed evidence read-only. Never overwrite the recorded attempts.

**Handoff:** qualified two-pin binding and negative-guard proof delivered;
candidate test-control assertion defect blocks unconditional approval. ROOT
can request a minimal author correction. This leaf stops with all historical
losses preserved and makes no full-Bash/native-parity/global-green claim.
