# Independent frozen DU + Overlay v7 replay report

Date: 2026-08-27

Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`

Freeze: `a08227b95b5ac3fc9175df6ca90a7700e5bdcbf4`

Freeze repository tree: `fbb92bc99161b52f4afdbdf2587f52f47e662d7e`

Freeze fixture tree: `cccd2d7693a10ac7609aa35db883b0530320383f`

Pre-replay audit commit: `d6814492`

## Decision

**V7 REPLAY REJECTED AS A FROZEN-FIXTURE FAILURE.** The exact immutable,
self-materializing replay exited 1 in the fresh source suite. Original source
passed 24/24 and fresh source passed 39/40, including the nested literal
environment table at 16/16. V5-023 failed because its observer-only file-read
control did not establish or retain an observable old file-atime precondition.
This is not evidence of a candidate product failure.

No retry, alternate runner, semantic workaround, product repair, or edit to
the frozen v7 inputs occurred. A newly versioned freeze is required. The
pre-replay audit remains an immutable checkpoint; actual execution supersedes
its static conclusion that all sensitivity controls were sound.

## Exact reached boundary and counts

The documented command used the full freeze and candidate IDs, new owned
`replay-001` directory, and pinned GNU 9.7 path. Bootstrap authenticated and
materialized the committed freeze, then executed that extracted runner against
an archive made from the exact candidate commit rather than live product bytes.

Reached:

- exact freeze/candidate resolution, 21-file freeze authentication and
  249-path candidate pre-admission: pass;
- in-memory forbidden-path and invalid-packlist controls: pass with zero
  writes, archive creations, or extractions;
- actual timeout/grandchild process-group control: pass;
- exact candidate archive and extraction: pass;
- source build: pass, 788 generated `dist` files;
- original source suite: 24/24 pass (17 holdouts, seven controls);
- fresh source suite: 39/40 pass;
- nested 16-row literal environment table: 16/16 pass, counted as one fresh
  record and not added to the 40-record denominator;
- all five v6 failure IDs corrected by v7—V5-020, V5-024, V5-029, V5-030 and
  V5-031—pass.

Not reached and receiving no pass credit:

- the four scoped regression files and their 128 tests;
- npm pack dry-run, packlist admission and actual npm archive;
- offline npm installation and physical consumer relocation;
- strict NodeNext moved-consumer typecheck and runtime;
- moved original/fresh suites and physical `nextLoad` attestation;
- wrong-root/source-fallback, missing-DU, restored-cleanup, and semantic
  declaration controls;
- all 16 native GNU environment rows.

There is therefore no npm package tarball hash, installed/moved package hash,
consumer result, native result, or scoped-regression result in this replay.
The retained `candidate.tar` is the Git candidate-source archive, not an npm
package.

## Exact V5-023 fixture failure

V5-023 read the correct 1,500-byte payload; its hash is
`b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809`.
Nevertheless its complete recorded stat object had file `atimeMs`
`1787861504449.238` both before and after the intended read. The recorded
`mtimeMs` was `1787861504446`, so the supposed pre-read sample was already
newer than mtime rather than demonstrably forced-old. Every other recorded
field was also identical.

The frozen V5-023 code calls `forceOldAtime()` but discards its returned setup
record and asserts no old-atime precondition before the real-adapter lstat/read
window. The raw result cannot safely distinguish whether the pre-action
provider observation advanced atime or the setup failed to remain observable;
either way, the required negative-control precondition is unproved. Treating
the unchanged atime as a product result would be invalid.

V5-024 independently demonstrates why this is a fixture defect rather than a
host-wide inability to observe file atime. Its retained setup proves root and
file atime were both exactly `946684800000` before action. Its real mutant then
recorded exactly two deltas: root directory atime advanced to
`1787861504457.411` after exact same-layer `readdir /` and was visibly
authorized; file atime advanced to `1787861504457.2258` after exact
`readFile /file.bin` and was the sole unauthorized delta. V5-024 passed every
corrected assertion.

## Visible metadata/atime evidence

All 19 composition metadata/DU records passed. Their lstat-only action windows
recorded 17 total deltas. Every one was directory `atimeMs` on an exact
same-layer/path actually listed by the action; every unauthorized-delta list
was empty. Those records contain zero mutation calls and zero content reads,
with unchanged bytes and entry sets. Direct stat/lstat rows observed no
unauthorized allowance. This is scoped evidence for those 19 source-build
records only, not a claim of full-stat purity or acceptance of the rejected
40-record freeze.

The other fresh lineages were 31/31 historical-frozen-derived, 2/2 lifecycle,
and 6/7 observer-policy controls. All seven negative-control records and all
four positive-control records passed; V5-023 is the sole failure.

The 16/16 candidate-side environment rows retain the literal policy
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`: selected invalid/empty values used
default units without lower-key lookup, valid selected 3,072-byte values used
one unit for the 1,500-byte payload, and explicit invalid `-B` failed before
filesystem calls. No native row ran, so those candidate results establish no
new native parity or native cwd evidence.

## Source, build and archive provenance

The selected candidate inputs remained exactly unchanged after the failed
suite: 249 files, 2,228,559 bytes. The canonical pre-build inventory file has
SHA-256 `2a6643eba131b08171d548eda8014ce67c1d125d92b949f4e1b93fc5d9e192ed`.
The generated `dist` contains 788 files totaling 3,739,166 bytes; the sealed
path/byte/SHA-256/mode inventory hash is
`e2b49840e964337172cc32840fcf596a1c678332edb257fd007cebecfc1fd853`.
The complete source tree contains 1,037 files totaling 5,967,725 bytes with
sealed inventory hash
`d57c25dc3a166c170c02fadc9a3293b962a1a81a6e4a2e758312b4c0dced5a86`.

The candidate source archive is 2,447,360 bytes, SHA-256
`b6c8055a335f5a3e316501267d5ed4590a765cf380cc44eec9d0e84774321381`.
The entire retained work tree was sealed before deletion: 1,038 files,
8,415,085 bytes, 88 directories, zero symlinks, file inventory SHA-256
`a9a46a2e93d029c90abfabca0aa2a7bddf9134ba7318bd588691652bea9aa68c`,
and complete-entry inventory SHA-256
`cde39d5e93d54352433f1f3bbf062d2e45f1982988d01b904c7dbecf9e225585`.
All per-file path, byte, mode and SHA-256 records are retained in
`RETAINED_SCRATCH_INVENTORY.json`.

## Frozen bytes, processes, cleanup and preservation

The materialized 21-file inventory hash
`db144097a79a98f9101a1d7cc2a2ac504861edc5f2099602ce2e6bfbca7c1728`
matched before cases, in the failure `finally`, and in the bootstrap parent
after the child. Each check verified exact path count, byte length, SHA-256 and
Git blob with no new/deleted file. The independent post-run verifier again
resolved freeze tree `fbb92bc99161b52f4afdbdf2587f52f47e662d7e`, fixture
tree `cccd2d7693a10ac7609aa35db883b0530320383f`, manifest SHA-256
`ae6c2dac28f30e94a6a4d07060cad8506608b5ec5aabeed254c964fd678c3ffc`,
all 21 files, and zero forbidden files.

Raw stdout, stderr, status, argv, cwd, hashes, timing and closure records are
retained for 57 materialized and 52 bootstrap processes. The fresh raw stdout
is 1,171,868 bytes, SHA-256
`902ba407c86363e9da3692453afb089941db06f9ea8675ef34e6ac98c91b0b4f`;
stderr is 2,403 bytes, SHA-256
`a61a3b4dee83a90c7bdd225be86f20ff67fe7f44a21042ede3971a3517253150`.
The original raw stdout/stderr hashes are respectively
`d000d3de02028a11555e6f97e418531b64cdc596669855009ffbb6b776bfc4de`
and `dda3727c055596ac8610c62da04757a77499b63c8b47deed2e9bcf82296f45b5`.

The frozen managers reported all 109 roots/groups closed. An independent
post-run signal-0 probe found no recorded root PID or process group alive and
found timeout grandchild PID 47293 absent. The timeout control itself records
root/group 47292 timed out and closed plus the reported grandchild closed.

Before removal, bootstrap scratch was sealed at 22 files, 418,374 bytes, nine
directories and zero symlinks. Then the verifier removed only the exact
inventoried work and bootstrap scratch paths; both actual post-removal probes
returned `ENOENT`. Raw evidence remains outside scratch. No `AGENTS.md` was
created, copied, edited, or found in owned inputs, scratch, bootstrap or final
evidence. The old unsafe migration harness was not run. The foreign index was
empty before replay and remains empty; unrelated worktree files were untouched.

## Permanent qualifications

The old refined-v2/pre-v3 bytes remain unrecoverable and the exact delta
permanently unproved. The old 22-fail/10-pass raw evidence, old33
qualification, prior 15-copy incident, and guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remain unchanged.

This partial rejected replay establishes no O060 behavior, three-ordering
native result, full native parity, GNU/Linux behavior, public/default DU,
deployed-provider behavior, whole gate, superiority, or completion claim.
