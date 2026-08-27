# Independent remaining split-writer verification

## Result and boundary

Candidate **79f11f1526224a1f34ffd64d7a32c63bdb971a0d**, parent
**8784a8fc0484313b914fe1ae6db33a8cfd0e0be4**, passes this bounded independent
verification. No product or candidate-test repair is requested. This leaf performed
the investigation and execution directly, without delegation. **Frozen8670 remains
UNQUALIFIED**, regardless of these results. No full gate was run.

The accepting attempt ran August 27, 2026, 15:56:03.626–15:56:27.646 UTC;
final authentication and bounded cleanup completed at 15:58:52.174 UTC.
This is actual recorded work, not a 72-hour, completion or superiority claim.
Only this new evidence/script directory was changed. Original source, helpers,
tests, goldens, root configuration, native executables and unrelated work stayed
read-only. Existing development tooling was used without installing dependencies.

## Exact inputs and unchanged semantics

`attempt-03/freeze.json` binds 288 candidate Git blobs, including all 44 committed
split evidence files, plus the complete isolated tree, live source/split witnesses
and native identities. The working copy is materialized from Git blobs, never a
live-source overlay. `candidate.diff.gz.base64` preserves the exact five-file candidate diff.
`attempt-03/inspection.json` records all 37 assertion calls and 91 array literals
across the five canonical files: predicates and vector literals are unchanged.
Only the two final edge/stress failure-message arguments are excluded from the
assertion-text comparison; they describe the new evidence destination.

`native.test.ts` and `native-errors.test.ts` are byte-identical to the parent and
were executed as regressions in every five-file canonical cohort. Product source,
`cases.ts`, `helpers.ts` and committed evidence are unchanged by the candidate.
Native identities and argv are unchanged. Edge adds a 10-second native timeout
where none existed; the reviewer did not increase any timeout or change any oracle.
Explicit edge and stress reports are **raw byte-identical** to their committed
latest goldens. No corresponding raw-byte equivalence is claimed for timestamped
or relocated dangling/native reports.

Environment: Darwin arm64, Node v22.22.2. Both native prerequisites were mandatory,
available, authenticated before/after and rehashed at each native launch:

- GNU coreutils 9.7 `split`: `cf5851c4e6566983ce69940b766c0b5eb0cd26ebf2bb45eefe215b2d5c62f958`.
- Apple `/usr/bin/split`: `7c2d5f3c73e849d664bad3a2f4c67c5154b0f03f59f2fa779d49e33dc7983f91`.

## Actual counts

| Cohort | Pass | Fail | Skip | Reports | Native processes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Concurrent canonical DEFAULT, all five files | 7 | 0 | 0 | 0 | 128 |
| Concurrent canonical CAPTURE=1, all five files | 7 | 0 | 0 | 7 | 128 |
| Exact candidate helper suite | 10 | 0 | 0 | Includes nested controls | 512 |
| Independent guards and instrumentation controls | 43 | 0 | 0 | Separate guard records | 0 |
| Dangling phase `fixed`, DEFAULT | 1 | 0 | 0 | 0 | 22 |
| Dangling traversal-like phase, CAPTURE=1 | 1 | 0 | 0 | 1 | 22 |

Scoped candidate `tsc -p tests/commands/split/tsconfig.json --noEmit`: exit 0.
No skipped or unavailable case is counted as a pass. The helper's four nested
children are two unchanged successes (7/0/0 each) and two deliberate reporting
negatives (1 pass, **6 expected failures**, 0 skips each). They are not extra
independent semantic coverage or genuine canonical failures.

Coverage per canonical mode: 43 GNU vectors, 20 Apple vectors, 9 error vectors,
4 cross-profile scenarios, 18 edge vectors, 8 stress input/argument combinations
with 16 chunk variants, and 11 dangling fixtures with 22 VFS observations across
MemoryFS and rooted RealFS. Native invocations total 812 in the accepting attempt;
this includes repeats and negative controls, not 812 distinct semantic cases.

The two modes use the exact five canonical files, `--test-concurrency=3`, strict
unhandled rejections and disabled TSX cache. DEFAULT removes the capture variable;
EXPLICIT sets exactly `VIRTUAL_BASH_SPLIT_CAPTURE=1`. Six initial test children
(80706–80711, three per mode) were alive at one rendezvous release,
15:56:10.690 UTC. The remaining files follow within each concurrency bound.
This establishes overlapping admitted execution, not CPU-level simultaneity.

## Attempted-write evidence, not just hashes

`audit.mjs` intercepts promise/callback/synchronous filesystem mutations, writable
opens, tracked descriptors, FileHandle writers and write streams before dispatch.
It records lexical and resolved authority paths and blocks writes to the live
repository or isolated candidate. ESM builtin bindings are synchronized before
test loading. Each pinned native launch records hash, argv, cwd, environment,
timeout, status and errors; native working directories must be owned OS-temp.

The final DEFAULT run records **3,548 mutation API calls, zero protected attempts**;
EXPLICIT records **3,562, zero protected attempts**. Helper regressions record
14,727, zero protected attempts. These calls include temporary-fixture operations
and overlapping API layers; they are not unique kernel-write counts. There were
zero native errors/signals and no unapproved synchronous child executables.

Eleven deliberate positive controls trigger the blocker: identical-byte promise,
sync and callback writes; promise/sync truncating opens; FileHandle and descriptor
writes; write stream; identical copy and rename; unlink through a directory alias.
They target an isolated committed-golden copy, never the original live evidence.
All are logged and denied before effect. An additional control verifies unlinking
an owned symlink does not unlink its protected target. Thus identical bytes and
EEXIST-suppressed attempted writes would not disappear into final-hash equality.

This is tested Node API interception plus pinned-native launch accounting, **not
kernel-wide syscall tracing** or a hostile-host security sandbox. Private bindings,
arbitrary native code, uninstrumented asynchronous child APIs and adversarial
concurrent mutation are outside the demonstrated boundary.

## Guards, failure retention and phase history

All 43 independent checks pass, including default nonserialization/no allocation;
three lossless failure-diagnostic round trips; six invalid/path-valued settings;
five invalid report names; repository root/descendant TMPDIR and symlink aliases;
twelve concurrent unique publications; existing/identical output, output symlink,
dangling symlink, directory symlink and replaced-directory refusals. Sentinel
bytes remain unchanged. Output files are 0600 within distinct 0700 OS-temp
directories. DEFAULT leaves no output or scratch; EXPLICIT has seven distinct
report directories and no scratch. All recorded canonical report paths are unique.

`SPLIT_DANGLING_PHASE=initial` in concurrent DEFAULT and `final` in EXPLICIT cannot
select old history files. Additional actual dangling runs cover `fixed` and a
traversal-like phase. Independent helper calls also exercise an absolute historical
path. All publication destinations remain newly allocated OS-temp paths, always
named `dangling-native.json`; committed initial/fixed/final history is unchanged.

The candidate helper's deliberate negatives change only observed statuses in
generated disposable test copies; the frozen candidate, product and native oracle
are untouched. DEFAULT retains six complete base64 failure reports in TAP;
EXPLICIT publishes seven JSON reports, including the one successful profile
control. The audit records exact successful publication bytes before helper cleanup.
`summary.json` independently checks complete cohort sizes and exactly one injected
mismatch in each failing report. Direct assertion exceptions can still precede
structured aggregate reports; their TAP remains the evidence.

## Preserved verifier failures and storage

Nothing from either earlier verifier attempt is relabeled a product failure or
discarded. Root-level `results.json` preserves attempt 01: a recursive audit logger
failed before tests loaded (0/5/0 per mode), then the rendezvous deadline fired.
`attempt-01-scripts.json` preserves its original audit/runner bytes. The correction
uses a preopened log descriptor and the original low-level synchronous writer.

Attempt 02 canonical modes already passed 7/0/0 each, but helper totals were 7/3/0:
the auditor wrongly dereferenced final symlinks during unlink cleanup, blocking
seven safe temporary-link removals. Raw records and original scripts remain under
`attempt-02/`. The precise fix resolves unlink's parent, not its final component;
the new through-parent-alias control still blocks an actual protected unlink.
No semantic assertion, oracle, candidate file or timeout was relaxed.

Large raw audit/TAP/result files are stored losslessly as `.gz.base64`, not as
TypeScript inputs or discoverable tests. `PACKING.json` records original paths,
byte sizes, original SHA256 and compressed SHA256. Every archive was decompressed
and compared byte-for-byte before removing its redundant raw representation.
This reduces approximately 159 MiB to 10 MiB without deleting failed evidence.
`RAW-DATA-PACKING.json` covers five additional exact diff/negative-TAP archives:
literal trailing spaces in those raw records triggered the initial staged
whitespace check. Lossless encoding preserves them; no captured bytes were trimmed
and no source/test lint waiver was added. The final staged whitespace check passes.

Decode a packed record with Node's `gunzipSync(Buffer.from(text, 'base64'))`.
`summary.json` is the compact authoritative result; `attempt-03/` contains the
accepting raw/packed receipts. The final script authenticates all three isolated
candidate trees immediately before bounded removal of exactly their recorded
top-level children. `cleanup.json` and `temporary-before-cleanup.json` manifests
preserve the identities and inventory. No broad temporary-directory cleanup ran.

Both before/after tree walks detect newly added entries, not merely changes to
initial tracked paths. All 44 goldens, candidate source and native binaries are
unchanged; final live tracked-source differences are empty. No other worker's
files, staging, native temporary artifacts, root files or commits are included.

Reproduce a fresh scoped attempt using `node tests/commands/split-stress/remaining-writers-review/review.mjs NEW_UNIQUE_ATTEMPT`.
It refuses an existing results destination. Publication checks are pre-write
identity checks plus exclusive creation, not a transactional race/ABA guarantee.
