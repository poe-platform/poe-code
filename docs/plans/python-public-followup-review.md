# Public Python follow-up user review

Date: 2026-09-13. Qualification uses the live working tree, built public
`poe-code/safe-bash` exports, the canonical filesystem bridge, and the separately
provisioned Pyodide 314.0.6 runtime. Native differential execution uses CPython
3.14.2. Earlier evidence remains in the original qualification documents.

## Manual review

1. Reproduce the command traceback and script-path TODOs with strict native
   comparisons. Add nested/chained exceptions and relative script operands.
   Fix validated defects without normalizing away observable differences.
2. Recheck memory, delayed, mount and read-only compositions. Reproduce the
   quota descriptor refusal and preserve unsupported mutation requirements.
3. Exercise ordinary create/edit/reopen document scripts, additional document
   edge cases, independent readers and representative rendered page images.
   Record document evidence in `python-public-document-followup.md`.
4. Run `npm run build`, the maintained public Python integration route, `npm test`
   and `npm run lint`. Keep the committed-export prerequisites and all ordinary
   unit membership intact. Report stopped gates separately from passing suites.
5. Capture and inspect CLI help, successful Python output and a failing Python
   invocation. Preserve exact statuses and screenshots in a new output folder.

Runtime assets are provisioned outside unit tests. Existing offline cache:
`output/python-public-integration-20260913/cache`. New raw evidence belongs in
`output/python-public-followup-20260913/`; existing captures are not overwritten.

## Limits

This finite review cannot establish every edge case or full CPython/Bash parity.
Quota writes, arbitrary remote providers, native subprocesses/extensions,
interactive terminals, in-Pyodide formula calculation and Word-to-PDF conversion
remain incomplete unless a specific verified result below supersedes that state.
External rendering is evidence about generated artifacts, not an in-Pyodide
renderer. Local edits, commits, remote delivery and releases are separate states.

## Results

The strict baseline reproduced missing inline traceback source and normalized
script filenames for both aliases. Expanded comparisons also exposed nested and
chained exception source omissions and relative `./`/`../` file spellings. The
launcher now registers compiled inline source with CPython's line cache and
retains relative path components when constructing the absolute script filename.
All 54 alias cases pass against rebuilt public exports, with exact status/stdout/
stderr comparisons. This includes twelve added cases for relative file spelling,
nested/chained inline exceptions and nested stdin exceptions. Stdin tracebacks
retain native omission of source lines. The four original TODO markers are gone.
The source registration uses CPython 3.14's `linecache._register_code`; this run
qualifies the pinned runtime, not arbitrary older Python runtimes. Independent
review confirmed the worker enforces Pyodide 314.0.6 before launcher execution,
and script loader path, compiled filename and `__file__` use the same preserved
operand. Directory/ZIP entrypoint metadata and symlink traversal remain outside
this new differential cohort.

Additional immediate/delayed filesystem probes reproduced `os.rmdir` returning
`ENOTSUP` on a read-only mounted directory. The bridge now checks read-only
authority before its unsupported-removal fallback, returning `EROFS`. The fast
regression passed 14/14 tests after first failing; snapshot-only removal
still refuses without invoking a potentially recursive backend. Further probes
cover open-file identity across rename/truncate and read-only namespace changes.

The original required quota read/write/recovery assertion still fails at its
first read with `ENOTSUP`. The wrapper declares descriptor access unsupported.
Additional refusal/recovery checks do not substitute for this required workflow.

The committed S3 export verifier independently reproduced the full-unit gate's
prerequisite failure: `Peer binding requires the selected committed package
metadata`, with zero verification steps. The current package metadata differs
from `HEAD`. No synthetic revision, changed membership or bypass was supplied.
See `s3-export-blocker.json` in the new output directory.

The root `npm run build` passed. Built CLI pipeline and traceback screenshots
were captured and visually inspected. The traceback now visibly includes
`raise ValueError(42)`; output is legible with no missing lines. A separate raw
process check records status 0 and stdout `42` for the pipeline, status 1 and the
full traceback for the exception, and status 2 for unsupported `python -i`.
See `cli-statuses.json`, `cli-pipeline.png` and `cli-traceback.png`.

The original baseline is preserved as `command-baseline.log`. The expanded red
run overlapped a rebuild near its end; its final second-alias shebang case saw
rebuilt code. Do not describe it as one immutable pre-fix build. Its earlier
strict failures and the separate original baseline establish the reproduced
defects. `python-execution.patch` records the narrow production change.

The complete maintained `test:python:integration` route passed with **69 test
entries: 68 passed, one TODO, zero unexpected failures, zero skips**, in 207.34
seconds. Counts include parent groups; this is not 69 passing workflows. The
remaining TODO is the required quota read/write/recovery workflow. Both expanded
document profiles passed; delayed document storage recorded 3,566 operations and
zero open handles. Memory/delayed composed filesystem effects, quota refusal
preservation, setup/install failure, offline cache reuse/integrity refusal,
cancellation, output exhaustion and subsequent successful runs all passed their
maintained assertions. Raw results are in `public-integration.log`.

[Document follow-up evidence](python-public-document-followup.md) records the
new stream/spool/Unicode-path coverage, independent readers and six inspected
rendered pages. The final aggregate also confirms the diagnostic-only change
made after that document capture run.

The first full unit attempt's shared stage passed 30,300 tests, with two skips.
The safe-bash runner self-tests passed 500/500 and retained discovery of 1,121
active TypeScript files. That attempt was stopped: the subsequent help screenshot
preparation rebuilt and temporarily removed compiled SafeJS filesystem exports
while safe-bash tests were importing them. Its module-not-found failures are an
orchestration error, not qualified product failures. The original `unit.log` is
retained. A fresh `npm test` was started after screenshot preparation completed,
with no overlapping rebuilds; its evidence is `unit-stable.log`.

`npm run screenshot-poe-code -- --output
output/python-public-followup-20260913/cli-help.png bash --help` completed and the
full screenshot was inspected. Runtime, package profile, cache/offline and limit
options are present and readable. The screenshot preparation's predev build
route does not replace the separately completed normal `npm run build` gate.

After screenshot preparation, all 25 recorded source/test/compiled hashes and
all five public-export hashes matched the successful integration inputs. See
`post-screenshot-hash-check.json` and
`public-export-post-screenshot-check.json`. There were no further product edits
or independent rebuilds during the stable full-unit retry.

The full `npm run lint` chain passed: guarded ESLint (12,359 inputs, zero
errors, 12 warnings in cached presentation examples), type checks, strict
filesystem/HTTP consumer contracts and workflow lint. `git diff --check` passed.

The stable `npm test` retry exited **1**. Its shared stage passed 30,300 tests
with two skips; Python spawn passed 29/29; runner self-tests passed 500/500.
The safe-bash stage completed all 1,121 discovered files and reported **38,874
test entries: 38,050 passed, one failed, 823 skipped**, in 727.27 seconds.
The only failure was `S3 HTTP root/subpath exports work from a clean packed
revision without source fallback`, with the same committed package metadata
mismatch reproduced separately. No module-not-found failure recurred.

The orchestrator stopped at that failed stage. Later `@poe-code/safe-js` and
`terminal-pilot` unit stages and root posttest were not established by this run.
No test membership or prerequisite was weakened. This is not a passing full
workspace gate, and skipped/unsupported cases are not passes.

Three reproduced product bugs are fixed locally: missing inline traceback
source, normalized script filename spelling, and the read-only `rmdir` errno.
The explicit quota descriptor workflow and broader limits above remain open.
No commit, remote-main delivery or release was performed.
