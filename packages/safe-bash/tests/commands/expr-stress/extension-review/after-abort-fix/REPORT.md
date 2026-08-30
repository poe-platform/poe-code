# Post-abort-fix acceptance: blocked preparation only

This different delegated leaf worked independently and did not redelegate. It
owns only this new directory. No product/shared/root, old tests, either frozen
tree, or prior `execution/**` file was changed, copied, or executed.

## Mandatory prerequisite did not arrive

The bounded receipt check ran from **2026-08-27 17:55:16 UTC** through
**18:00:16 UTC**. At 18:00:16.001 UTC,
`/tmp/expr-extension-final-review-candidate.txt` was still absent. The prior
execution directory had no committed path history at the preparation check.
In accordance with the explicit five-minute bound, this leaf stopped acceptance
preparation rather than silently using the dirty harness or waiting indefinitely.
There is **no accepted harness commit, candidate execution, or acceptance** here.

## Exact source binding and attribution

- Fixed source: `27a7793526830768484885afba5832bf8bb248b5`.
- Source tree: `a68ba3a650473e23a96511535cec0d4833688da8`.
- Author evidence: `33b580db854b578c41cb73435e2b0dd280350503`, referenced only.
- Compared with immutable old source `fe7083d9` (full ID in `PREPARATION.json`).
- Complete `src` delta: seven added `src/commands/du/` files from separate-owner
  commit `877144ea`, and changed `src/commands/regex-execution/client.ts` from
  the cancellation-fix commit. The eight paths and exact before/after SHA-256
  hashes are enumerated in `PREPARATION.json`; this is not a one-file candidate.
- `package.json` and `package-lock.json` have no delta between these sources.
  No installed distribution or root/default/subpath expr export is certified.

## Actual preparation checks

Both original and extension frozen read-only verifiers passed. Git byte checks
against `35aa8054` and `92fe8a63` passed. Their manifest-listed verification
does not establish append-proof inventory, candidate execution, or native replay.
The pinned GNU9.7 executable, release archive and `expr.c` SHA-256 values matched
the original receipt. The executable reports GNU coreutils 9.7 on this Darwin
arm64 host; no GNU/Linux profile, signature verification, or binary rebuild is
claimed. Node was v22.22.2. No native prerequisite was substituted or skipped
and counted as a release-proof pass.

Six local native AbortController preparation controls observed exact thrown
`signal.reason` identity. Native `abort(undefined)` produced an AbortError,
not synthetic undefined; native 0/null/false/empty-string/Error retained input
identity. These host-only checks **do not** satisfy the required fully typed
structural consumer, moved-installed cancellation proof, or cleanup acceptance.
WHATWG DOM and official Node globals were consulted via web.run for this
distinction; source locations and actual local outcomes are in
`PREPARATION-CHECKS.json`.

## Every acceptance obligation remains open

`OPEN-CONTROLS.json` individually identifies every frozen safety/workflow,
extension boundary and mutation specification, plus each bounded ReDoS input:
16 safety, 7 workflows, 4 ReDoS inputs, 24 boundary and 32 mutation entries.
**Every subrequirement of every listed specification is UNEXECUTED.** The four
ReDoS input entries overlap the safety specification; these 83 entries are not
83 executed tests. Additional installation, typing, provenance, regression,
watchdog and worker-accounting obligations are explicitly listed there.

Original GNU104 (95 C + 9 en_US.UTF-8), extension GNU23 (20 C + 3 en_US.UTF-8),
and quoted-correction1 were not replayed. Apple remains separate. The supplied
old-source C results (95/95 semantic, 87/95 strict; 20/20 semantic, 19/20 strict;
correction1/1), and author 103/111 before, 111/111 after and overlapping 377/377
focused results are **historical/reported only**, not independently reproduced.
No new semantic, strict, mutation, native-parity, or installed-proof pass count
is assigned. Unsupported locale/diagnostic/nullable-capture gaps remain open;
`7f22cb8c` remains historical limitation evidence, not a changed GNU/POSIX policy.

## Cleanup and next prerequisite

No product workers or temporary fixtures were created, no untrusted regex was
run, and both bounded polling processes exited. Zero product-worker creations
and terminations reflect nonexecution, not a tested cleanup guarantee or opaque
host-promise drain. No SIGSTOP, source edits, harness corrections, or old evidence
rewrites occurred. Unrelated staged/worktree changes were left to their owners.

There is no new canonical runner or capture mode because harness approval never
arrived. These preparation records are plain JSON/Markdown, outside test discovery;
no raw TypeScript fixture is introduced. Resume only under a new assignment with
the sealed prior receipt/commit. No superiority, full-gate, expr-completion,
product-failure, or post-fix acceptance conclusion is warranted by this record.
