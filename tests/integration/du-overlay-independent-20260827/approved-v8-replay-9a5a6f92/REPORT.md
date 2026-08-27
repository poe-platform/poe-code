# Independent frozen DU + Overlay v8 replay report

Date: 2026-08-27

Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`

Freeze: `ae0f8b3f4f927b06718fc51e176ca7a54b517364`

Freeze repository tree: `bf0d08a7a5640a1cb8aa0d1871d0b68d89cfc170`

Freeze fixture tree: `8c845070afd27a3be5038b50d222f36dd9178838`

Pre-replay audit commit: `2477d20c385adf55e3f737eb1dada4e1f9139931`

Actual run: `replay-001/run-2026-08-27T203020598Z-9c8b02`

## Decision

**V8 REPLAY REJECTED AS A FROZEN-FIXTURE ATIME-PRECONDITION FAILURE.**
The exact immutable self-materializing replay exited 1 in the fresh source
suite. Original source passed 24/24 and fresh source passed 38/40. V5-023 and
V5-024 both proved that their setup momentarily established the requested old
file atime, but each file atime advanced before the verifier's recorded
pre-action sample. Neither control retained its required precondition. The
evidence does not attribute the intervening access, and it does not establish
a candidate product defect.

No retry, alternate semantic path, assertion change, product repair, native
run, or frozen-byte edit occurred. Later phases are unexecuted and receive no
pass credit. A new frozen version is required before candidate acceptance can
be attempted again.

## Reached boundary and exact counts

The documented CLI used the full freeze and candidate IDs, new owned
`replay-001`, and the pinned GNU 9.7 path. Bootstrap authenticated and
materialized the committed freeze. The extracted runner then archived and
built the exact candidate commit rather than live source bytes.

Reached:

- exact freeze/candidate resolution, 22-file freeze authentication, and
  249-path candidate admission: pass;
- forbidden-path admission control: rejected in memory with zero writes;
- invalid-packlist control: rejected before archive, write, or extraction;
- actual timeout/grandchild process-group control: pass;
- exact candidate archive and extraction: pass;
- source TypeScript build: pass;
- original source suite: 24/24 pass, including 17/17 holdouts and 7/7 controls;
- fresh source suite: 38/40 pass;
- nested 16-row candidate environment table: 16/16 pass, counted as one fresh
  record and not added to the 40-record denominator;
- metadata/DU prefix: 19/19 pass, with 19 visible authorized directory-atime
  deltas and zero unauthorized deltas;
- ordinary positive controls: 4/4 pass;
- negative controls: 6/7 pass, with V5-024 rejected because its required file
  atime precondition did not survive to the before sample;
- fresh lineages: historical frozen-derived 31/31, lifecycle additions 2/2,
  observer-policy controls 5/7.

Unexecuted and receiving no pass credit:

- all four scoped regression files and their 128 tests;
- npm pack dry-run, packlist admission, and actual npm package creation;
- offline installation and physical consumer relocation;
- strict moved-consumer NodeNext typecheck and runtime;
- moved original/fresh suites and physical `nextLoad` attestation;
- wrong-root/source-fallback, missing-DU, restored-cleanup, and semantic
  declaration controls;
- all 16 native GNU environment rows.

Consequently, there is no npm package hash, installed or moved package hash,
consumer result, declaration-control result, native argv/env/cwd result, or
`nextLoad` record in this replay. The retained and sealed `candidate.tar` was
the Git source archive, not an npm package.

## Exact atime-control failure

V5-023's setup recorded requested and observed file atime `946684800000`, with
`demonstrablyOld: true`. Its lstat-only before sample instead recorded
`1787862625919.392`, newer than mtime `1787862625917`. The subsequent locked
1,500-byte real-adapter read returned SHA-256
`b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809`,
but before and after stats were identical and the complete delta list was
empty. All non-atime fields remained exact. The corrected assertion therefore
failed rather than accepting an unproved file-atime effect.

V5-024 independently recorded old root and file setup values of
`946684800000`, both initially `demonstrablyOld: true`. Its measured root atime
remained old before action, but measured file atime had already advanced to
`1787862625926.3386`, newer than mtime `1787862625921`. The mutant action log
then recorded exact `readFile /file.bin` followed by exact `readdir /`. The
file atime did not advance again. Root directory atime advanced from
`946684800000` to `1787862625926.834` and was the sole action-window delta,
authorized by that exact same-layer listing. The full unauthorized list was
empty. This is separate from, and not added to, the 19 metadata/DU delta count.

V5-021's real directory-listing control passed, V5-022's lstat stability
control passed, and V5-025 through V5-027's non-atime-stat, byte, and entry
mutants passed. The two failures show that the frozen file-atime precondition
remains sensitive between setup observation and pre-action sampling. They do
not show DU or Overlay product mutation.

## Visible metadata and environment contract

All 19 composition metadata/DU records passed. Their lstat-only action windows
recorded 19 directory `atimeMs` deltas, each backed by exact same-layer/path
`readdir` provenance. Every unauthorized list was empty. They recorded zero
explicit mutation and zero content reads, with unchanged backing bytes and
entry sets. The effects remain visible; this is not a full-stat-purity claim.

The candidate-side 16/16 environment rows preserved literal precedence
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`. Selected invalid or empty values used
default units without lower-key lookup; valid selected 3,072-byte values used
one unit for the 1,500-byte payload; and invalid explicit `-B` failed before
filesystem calls. Because the native phase was not reached, these rows provide
no new GNU parity or native-cwd evidence. The oracle itself was authenticated
statically before replay as mode `0755`, SHA-256
`f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`,
but was not executed.

## Source, build, archive, and tool provenance

The selected candidate inputs remained exact after the failed suite: 249 files
and 2,228,559 bytes. The frozen pre-build JSON inventory SHA-256 is
`2a6643eba131b08171d548eda8014ce67c1d125d92b949f4e1b93fc5d9e192ed`;
the sealed mode-inclusive file inventory SHA-256 is
`2fb6f0fe53822ddbffa6643de813bef61f5c42a84e5530e57f29be21499721c0`.

The successful build produced 788 `dist` files totaling 3,739,166 bytes. Its
file inventory SHA-256 is
`e2b49840e964337172cc32840fcf596a1c678332edb257fd007cebecfc1fd853`;
complete-entry inventory SHA-256 is
`cc4501b4528be139a65ba85f49c30dc3cc263ac356b4d5e7c1e96dd6a514c9d1`.
The complete built source tree contained 1,037 files and 5,967,725 bytes, with
file inventory SHA-256
`d57c25dc3a166c170c02fadc9a3293b962a1a81a6e4a2e758312b4c0dced5a86`.

The candidate source archive was 2,447,360 bytes, SHA-256
`b6c8055a335f5a3e316501267d5ed4590a765cf380cc44eec9d0e84774321381`.
The entire work scratch was sealed before deletion: 1,038 files, 8,415,085
bytes, 88 directories, zero symlinks, file-inventory SHA-256
`a9a46a2e93d029c90abfabca0aa2a7bddf9134ba7318bd588691652bea9aa68c`,
and complete-entry SHA-256
`cde39d5e93d54352433f1f3bbf062d2e45f1982988d01b904c7dbecf9e225585`.

The actual recorded tools were Node v22.22.2 at SHA-256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`,
npm 10.9.7 CLI at SHA-256
`8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7`,
TypeScript 5.9.3 CLI at SHA-256
`8d5fa5bd883fec0979fc2004f1fe1d99aef40570155d550eadc0b03b55513bf0`,
and tsx package 4.23.12 at package-file SHA-256
`96aee9fd252d0cc31f3c01468250961f5b338c797bc208700d7db926450c7659`.
The build process exited 0 with empty stdout/stderr hashes.

The fresh verifier directly loaded and hashed eight files below the built
source `dist`: memory, overlay, readonly, mount and real filesystems; DU;
contracts; and Shell. Those exact path/byte/hash records remain in raw process
59. No installed physical-module or `nextLoad` claim is made because those
stages were unexecuted.

## Frozen bytes, raw logs, closure, and preservation

The materialized 22-file inventory hash
`5bf4b5ca1a2c560f8c9be39e81813f9c12bb943748275d3def20da46562d6269`
matched before the child, before cases, in the failure `finally`, and in the
bootstrap parent after the child. Each check verified complete path count,
byte length, SHA-256, Git blob, and no new/deleted entry. A post-run immutable
Git verifier again resolved the freeze tree and manifest SHA-256
`e8f957bd9ea434b0af5388ab0e2ed2d936d5338fcbca5344f3793b08e5e38af7`,
verified all 22 paths, and found zero forbidden files.

Raw stdout, stderr, status, literal argv, cwd, hashes, timing and closure
records are retained for 59 materialized and 54 bootstrap processes. All 226
stdout/stderr hashes independently match their process records. Fresh stdout
is 1,173,839 bytes, SHA-256
`800f0de73706f4014da763c1c8fa2d9c250ac440e5f620dae77d1667c81c617e`;
fresh stderr is 2,630 bytes, SHA-256
`e9b9446c61e91860e30fdc2f9d1b56bea612b07e6da596cc40ca78cc36a545fd`.
Original stdout/stderr hashes are respectively
`5f0c4f9dabcbbaf4f5a7d5a1e7c11d5aad44600c35fd479c69af9dfac453b180`
and `dda3727c055596ac8610c62da04757a77499b63c8b47deed2e9bcf82296f45b5`.

The managers recorded all 113 roots and groups closed. An independent
post-run signal-0 probe found no recorded root PID or group alive and found
timeout grandchild PID 97364 absent. The actual timeout control records its
root/group timed out and closed plus that grandchild closed. Bootstrap scratch
was sealed at 23 files, 426,359 bytes, nine directories, zero symlinks, then
both exact retained scratch roots were removed and independently probed at
`ENOENT`. No worker or subagent was created. No `AGENTS.md` was created,
copied, edited, or found in frozen inputs, candidate inputs, scratch, bootstrap,
or final evidence.

## Permanent qualifications

The rejected v7 evidence remains rejected and unchanged. This v8 replay does
not establish O060 behavior, the three retained native-ordering differences,
GNU/Linux semantics, broad native parity, package/consumer acceptance,
public/default DU, deployed-provider behavior, whole-gate acceptance,
superiority, or completion. The old refined-v2/pre-v3 bytes remain
unrecoverable and their exact delta permanently unproved; the old 22-fail/
10-pass raw record, later 33-case qualification, prior 15-copy incident, and
guarded commit `b1b5abe972bbfc2feffbf04b8c2c98f324391923` remain untouched.
