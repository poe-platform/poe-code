# Final constructor author-integration check — August 27, 2026

AUTHOR integration only, not Dirac independent acceptance. No repository writes,
commits, builds, fixture edits or qualification changes. No independent exclusive
tree was edited or added to the execution snapshot.

## Results

WebDAV resource-id.ts now conflicts only for built-in same + explicit distinct.
The previous explicit same + built-in distinct dispatch discrepancy is resolved.
Both runs verified 20/20 narrow controls: S3/WebDAV x constructor/late replacement
x same/distinct, distinct/alias, unknown/distinct, EACCES/alias, cancellation/alias.
Callbacks ran once with correct receiver, followed paths and signal. Replaced
constructor hooks ran zero times. Comparison performed metadata-only requests;
source [1,2], target [9] and both names remained unchanged.

Both runs also passed the identical frozen cohorts, separately counted:
- Original43: 43/43 = 38/38 required positives + 5/5 controls.
- Original source-loss guards: 4/4.
- Required alias guards: 49/49.
All commands exited 0. No failures, skipped, cancelled or TODO tests.
The five controls are:
- ok 7 - paired alias control: opaque does not manufacture disjoint scopes
- ok 8 - paired alias control: real-shared-root does not manufacture disjoint scopes
- ok 23 - paired s3 opaque separate-client alias stays unchanged (traversal may reject first)
- ok 38 - paired webdav opaque separate-client alias stays unchanged (traversal may reject first)
- ok 43 - declared S3 default rename limit remains typed ENOTSUP and effect-free

## Source boundary and single rerun

Initial run HEAD: ceb3f5ff88624d6366a2b0f3810d6a93e489a327. Its inputs were stable during execution.
A subsequent final-live check detected changes to:
- src/commands/streams.ts
- src/commands/text.ts
These changes were not made by this review. The requested one replay ran against
a new byte-identical worktree snapshot. The two runs and outputs remain separate.

Final replay HEAD before/after: e9783ecd393efd8af1b892c94f73a863d28650a7 / e9783ecd393efd8af1b892c94f73a863d28650a7.
Final-live HEAD: e9783ecd393efd8af1b892c94f73a863d28650a7.
Final replay source-set SHA256: e5673f9dd6ce311af7565dfb16e56145e2cd4cd8460c24494c09829db53f533b.
Final replay before/after hashes equal: true.
Live differences since final replay: [].
FS/contracts worktree status at final replay boundaries: clean.
Final-live FS/contracts status: "".
All-source live status: "M src/commands/streams.ts\n M src/commands/text.ts".
Thus FS integration is at committed owner boundaries (S3 629ed27 and WebDAV
408ff59), but this is not a claim of a globally clean worktree. No broad FS suite
or whole-product acceptance ran. No further replay is scheduled.

Source SHA256, unchanged for these FS/contract files across both runs:
src/fs/s3/authority.ts
1a95f7a28904b8607948673db3e99d3d4a49b2a3839d980143fe13c25e1af344

src/fs/s3/filesystem.ts
af2ee439cbabdc3babe008da2601ccc1a031555edc5e082f8711f4512db01411

src/fs/webdav/resource-id.ts
ee5720f77a352503368d672caaf5237e45863bde88cf69b947d14178fcda49f2

src/fs/webdav/webdav.ts
36e9b5eb6f012df25bd5bb529d29716400f53a6ffa593d75b78f19f77c791b22

src/fs/memory/index.ts
2ece749f3f22be6a0da76dcd964feb9b1055e742a05c727c43f672e9bc7ec8b4

src/fs/mount/comparison.ts
cedfd2b4a586ddf85eaac30e1ce7797b290b712b744498e84df5036c89f64a2c

src/contracts/filesystem.ts
7c72ddef5660c9a1bd62910d3155a4278ce8d7607f811b32d27cf21149be4009

Frozen fixture/helper SHA256 (verified against immutable eab1d48 manifest):
tests/fs/mount/identity-compatibility-review/compatibility.test.ts
9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734

tests/fs/mount/copy-identity.test.ts
e752e633abc902025670c09305c09e7319b171549350ddec7573b6644d29d115

tests/fs/mount/copy-identity-guards.test.ts
bd8074c17c5e0fc418a5408028b409946b2178e64fad29bfa87c5f8aa1eb8027

tests/fs/overlay/copy-identity.test.ts
d877488ecc76799552313b55db0119c83ecf433ad17ceb88079fa0d9bddd872e

tests/fs/overlay/helpers.ts
eea3cd58d312d40b3a3903a8d3e4a4f3ad9ffc26a359acb581ac530d67f0718a

tests/fs/webdav/mock.ts
177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36

## Exact reproduction and raw capture

Each run used its own run-N/snapshot working directory because the original
unchanged tests create temporary real directories beside their fixtures. Both
snapshot source and fixture bytes were verified exact after execution; runtime
temporary namespaces stayed under this /tmp folder. No test was qualified or
rewritten. The only additional probe is run-N/snapshot/probe.mjs.

Commands (exact argv and absolute executable also in each command JSON):
node --unhandled-rejections=strict --import tsx probe.mjs
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/fs/mount/identity-compatibility-review/compatibility.test.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/fs/mount/copy-identity.test.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/fs/mount/copy-identity-guards.test.ts tests/fs/overlay/copy-identity.test.ts

run-N/{dispatch,original43,original4,required49}.json captures argv/cwd, timestamps,
exit status and live source/input manifests before and after each command.
Matching .stdout/.stderr contain exact raw bytes verified against original
process-output hashes; every stderr stream was empty. The patch writer's added
newline for empty capture files was removed to restore exact empty stderr.
run-N/before.json and after.json contain full source and fixture hashes.
original43.observations.json retains the fixture's exact per-case byte/namespace
and provider traces. summary.json is run1; summary-rerun.json retains both runs.
final-live.json captures the last live hash/status check. run.mjs records the
bounded second replay; only the two recorded attempts were executed.

Historical original31/38, qualified38/38, old failures and immutable repository
evidence remain unchanged. All review-launched commands have finished; there is
no active review worker process. This is not future Dirac acceptance.
