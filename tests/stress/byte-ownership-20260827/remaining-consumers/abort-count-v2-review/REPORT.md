# Independent fixture-only review: SIGNOFF

This signs off only explicit abort-count-v2 on accepted product
`b282159921ce530e932b02f90c64eca987de2704`. No source changes, current-product gate,
feature expansion, provider claim, superiority claim or historical result rewrite.

## Commits and actual execution

- Author fixture: `93a068bcb52ede65323689868b231bc2f56f641b`.
- Independent frozen controls/review: `69b03a103516c15327e6e7be07f95aacc861dd8c`.
- Author narrow-probe evidence: `20235a6fdf35c9023f6c8b110bf44f45855395c6`;
  committed hashes and ready marker verified in `evidence/author-ready.json`.
- Both freezes precede this reviewer execution; marker text and committed-fixture
  hash verification are retained in `evidence/preservation.json`.
- Actual revised public suite: **24/24**, zero failures/cancellations/skips/TODOs.
- Independent controls: **6/6**, including four negative guards that reject
  old-count, wrong-reason, accepted-byte and missing-finalization mutants of real
  observations. Baseline observations pass before mutation. No static-string-only
  negative guard and no extra feature matrix.
- Exact command: `node tests/stress/byte-ownership-20260827/remaining-consumers/abort-count-v2-review/run.mjs 93a068bcb52ede65323689868b231bc2f56f641b`.
  The runner is append-only, requires absent owned `.work`, and deliberately pins
  accepted b282 rather than silently admitting a changed product candidate.
- Historical first21/24, accepted-product old-fixture23/24 and original direct1/2
  remain unchanged. This new24/24 is not a correction of old scored results.

## Reviewed migration and contract proof

The complete reviewed diff is `evidence/reviewed-delta.patch`. Prefix/suffix outside
the one jq abort case are identical. All helper/vector/archive bytes are identical.
The callback, raw chunks, signal forwarding, command, source and producer timing
are unchanged. Only yielded and unchangedChecks expectations move from 1 to 2;
new checks strengthen stderr, rejection-vs-result, disposal and stable effects.
No assertions are relaxed and no numeric abort exit status is fabricated.

`EXPECTATION.md` records the independently derived schedule before execution.
On second next, the first yield's finally increments unchangedChecks to 1;
resumed becomes 1; afterRead aborts but returns normally. The producer locally
reaches the second empty yield, so yielded becomes 2. The pending abortable read
has already rejected with the exact reason, so that empty view is not delivered.
iterator.return closes the second yield (unchangedChecks becomes 2), skips another
resumed increment and executes the outer finalizer. Correct state is
`{yielded:2,resumed:1,finalized:true,unchangedChecks:2}`.

The independent readBytes trace delivered only `41e2`, then recorded the single
afterRead callback and synchronous abort return. This distinguishes local yields
from consumed chunks and new host operations after cancellation. Public jq rejects
the original Error object, with empty stdout/stderr, one source opening, unchanged
`/input` bytes `41e282acff0a42c328`, finalization before the state assertion and
stable state/effects through awaited disposal. Diagnostic status is null, not zero.

The contract does not promise hard-preemption or waiting for opaque uncooperative
input return promises. These results cover this immediately cooperative helper;
registered invocation cleanup has its separate public settlement contract.

## Package and source authentication

Read-only fixed assets from fix-review were reused, not rebuilt in root dist.
All 215 archived source/config/doc files were checked against exact git b282 bytes.
The source archive hash matches retained build evidence; the prior successful tsc
build command/status is embedded in `evidence/authentication.json`.
All 705 staged build/manifest files match prior build pins. The existing npm-packed
tarball was hashed, copied into owned scratch, physically moved again, extracted
and compared file-for-file to the staged build and prior installed package.

- Source archive SHA-256: `0ae6a9c8324ad1f5b317f4ae727ca8bb47320dd47c74613d15d3917d0be10ecf`.
- Moved npm tarball SHA-256: `1b147c8e7854615b03db5eaedbfa1926f9dafc3fa95e91b0d1e0564af95b2c8e`.
- New public fixture SHA-256: `e5d6d61967e2b5a72fa51e7e7691ed7c98183a8fac7e5e1e2c8538180dbf82e0`.
- Old public fixture SHA-256: `da1a8fc6fcd0eb2bf79c7429c22d641e3af432c9d51edf965deff8525bbf7b3b`.

Each run authenticated 173 actually loaded package modules, rejecting unpinned
package module paths or differing loaded bytes. Public root/archive/network imports
resolve to the moved package; io, jq input/command and Shell modules are present.
Before/after fixture, source, build, installed-package and live source hashes are
recorded; no changes occurred. All 83 author-pinned sealed historical artifacts,
including original direct evidence, still match. No author-owned file was edited.

Observed run HEAD was `c4783b71c463b78d3a6201f9ce61657722ea01bc`, not b282.
The recorded source delta is confined to `src/commands/env-split.ts` and
`src/commands/execution.ts`; those changes were not tested or certified here.
Eight exact relevant contract/input/jq/network/Shell paths match b282 and current
bytes individually in `relevantBinding`. Current checkout is not claimed equivalent
to accepted b282 merely because these relevant paths match.

## Discovery qualification for Curie

Independently read `package.json` scripts and listed, without running all tests:

`node --input-type=module -e "import { globSync } from 'node:fs'; console.log(globSync('tests/**/*.test.ts', { exclude: path => path === 'tests/commands/regex-execution/continuation/artifacts/native' }));"`

Node v22.22.2 returned **557 .test.ts paths**, saved in `evidence/discovery.json`.
Only `remaining-consumers/direct-curl/direct-curl.test.ts` appears in this subtree.
Neither old nor v2 public.mjs is selected by that default canonical npm-test list.
The quoted glob is expanded by Node fs.globSync, not by the shell. The npm wrapper
then invokes `node --import tsx --test` with those explicit files and forwards user
arguments; an explicit extra path is a different profile, not excluded universally.

`remaining-consumers/run-packed.mjs:82` copies old public.mjs, and line 92 explicitly
runs that moved file. `fix-review/history-replay.mjs:48` copies it and line 57 names
the original-packed24-candidate profile. Searches of package.json/scripts/docs found
no remaining-consumers registration; README/REPORT and authentication records are
historical harness/evidence references, not default test discovery. `test:contracts`
has its distinct contracts-only pattern. No claim is made that every Node pattern
can never select .mjs: this review explicitly ran the new .mjs file with --test.
No root config, glob exclusion or test-discovery waiver was added.

## Resources and remaining limits

Both runs used strict unhandled rejections, sequential test concurrency and the
original 15-second per-case watchdog, plus a generous 180-second parent timeout
with SIGKILL for the exact owned child only. Both children exited naturally with
status 0 and signal null. Closure reports contain only two PipeWrap stdio resources;
all Shell context-after disposals were awaited. Loader workers ended with their
test processes. No server, external network, regex probe or product subprocess ran.
There are no retained owned child sessions. `.work` retains only ignored replay
artifacts; tracked owned files are committed independently of foreign work.

This is fixture closure, not a rerun of canonical557, historical direct2, independent
34, deployed backends or a full product gate. No 72-hour duration claim is made.
The retained unified-diff evidence contains an intentional single-space blank
context line; whitespace lint may flag that evidence line, not executable code.
