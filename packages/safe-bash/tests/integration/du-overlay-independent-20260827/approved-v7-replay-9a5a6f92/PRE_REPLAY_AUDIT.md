# Independent v7 pre-replay audit

Date: 2026-08-27

Decision: **ADMIT THE EXACT FROZEN V7 REPLAY.** This is a static, bounded,
pre-execution judgment only. No candidate semantic case, native row, product
build, package, consumer, or regression test was run before this checkpoint.

## Authenticated inputs

- Candidate commit: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`, tree
  `62c1b2f2784ca465b17d4b15a5736c42b8bdcf2d`.
- V7 freeze commit: `a08227b95b5ac3fc9175df6ca90a7700e5bdcbf4`, repository tree
  `fbb92bc99161b52f4afdbdf2587f52f47e662d7e`, fixture tree
  `cccd2d7693a10ac7609aa35db883b0530320383f`.
- V7 manifest Git blob: `d2d09ec66ea193d7b39d2d6e0bc018f8986d8511`;
  SHA-256 `ae6c2dac28f30e94a6a4d07060cad8506608b5ec5aabeed254c964fd678c3ffc`.
- The independent frozen verifier resolved the exact commit and verified all
  20 non-self records plus the manifest: 21 total regular files, exact paths,
  byte lengths, SHA-256 values, Git blobs, no additions/deletions, and zero
  `AGENTS.md`. Every frozen file mode is `100644`.
- The candidate-selected list has SHA-256
  `9427aad46a7f184d94517a666ab02a8f1da43ccf9074c5a15186d4569233679b`
  and resolves in exact ASCII order to 249 unique paths at the candidate
  commit, with no forbidden path.
- The pinned oracle realpath is
  `/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du`;
  its independently read SHA-256 is
  `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`,
  matching the frozen GNU coreutils 9.7 identity. It was not executed here.

## V6 lineage and exact V6-to-V7 classification

The immediate v6 commit is `cea13e21b26e3bf85c60e56e7a846e28b6f68720`
(tree `b61988ff4a23a6a90d5ffa15149b314af0ae6c63`). Its pre-audit commit
`3b5a1b18c658826f995b830a813468879598ff0b` and rejected replay commit
`378206a259f55f85090dca4f1828450b60509329` resolve exactly. The rejected
evidence manifest blob/SHA-256 are
`b5de7476c0c27f02fe92fa5eacbb56a338681d22` /
`b9fb887103ba2ff15f26cb4c43075dae1179315bf1ced679603e9edf3b47310e`.

Relative-path comparison authenticates the complete v7 classification:

- 13 files are byte-identical to v6, including the original 24-case verifier,
  16-row fixture, candidate inventory, consumer, loader, process manager,
  timeout control, native driver, oracle identity, and tooling record.
- Six files differ as declared: `CASE_MAP.md`, `FREEZE.md`, `ORIGINS.json`,
  `harness/verify-v5.mjs`, `replay.mjs`, and `verify-freeze.mjs`. Every declared
  v6 blob and SHA-256 matches independently. The last two diffs change only
  the frozen relative path from v6 to v7.
- `CORRECTION_V7.md` is the sole new non-manifest file. `MANIFEST.json` is the
  expected regenerated self-excluded inventory.
- The only origin-record correction is the documented terminal `b` missing
  from the v6 selected-path SHA text; the v6 file and manifest bytes were
  already correct.

## Assertion and sensitivity audit

The v7 delta is surgical and conforms to the approved policy. The V5-020,
V5-028, V5-029, V5-030, V5-031, active-stage, and behavior-mutant windows take
lstat-only samples immediately around the action. Recursive byte/entry
observers sit outside those windows. Full normalized stat objects and all
field deltas remain recorded. A delta is authorized only when it is directory
`atimeMs` and the action log contains an exact same-layer, same-path `readdir`.
Stat/lstat and observer-only activity receive no allowance; mode, identity,
ownership, size/allocation, mtime, ctime, birthtime, links, file atime, bytes,
and entry sets remain checked.

The V5-024 control performs no preliminary file-content read. It establishes
and re-reads forced-old root and file atimes before the measured action,
requires the real file read to advance file atime, requires exactly one visible
authorized root-directory atime delta, and requires exactly one unauthorized
file-atime delta with no other changed field. Mode, byte, entry, content-read,
upper-removal, copy-up, ordinary mutation/cleanup, lifecycle, error/retry,
pre-/mid-abort, admission, and active-stage controls remain live. No atime
field is globally removed or called full-stat purity.

The environment fixture contains 16 unique rows and reconstructs exactly 1,500
bytes with SHA-256
`b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809`.
It covers default, valid selected, invalid selected, empty selected, valid
explicit override, and invalid explicit `-B` outcomes across
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`. Selected invalid/empty values are
compared to default and against lower-key results; explicit invalid `-B`
requires failure before filesystem calls. The virtual driver checks exact
status/output and metadata-only calls. The native driver uses the same literal
argv/expectations, sanitized per-row environment and actual per-row cwd;
any literal or strict-rejection mismatch makes the native process fail.

## Replay protocol audit

The runner is the v6 protocol byte-for-byte except for the frozen path. It:

- resolves full commit IDs; authenticates selected sources before candidate
  archive creation; lists and rejects forbidden paths before extraction;
- runs `npm pack --dry-run` before the real archive, proves the dry run created
  no tarball, admits the complete dry-run plan against hashed build inputs,
  then checks the actual npm record and tar listing before extraction;
- requires zero production/optional/peer/bundled dependencies and records the
  sole hashed local tarball as the offline dependency admission before install;
- inventories consumer inputs before copying, physically renames the installed
  consumer, compares complete packed and installed bytes, runs strict NodeNext
  with `skipLibCheck: false`, and attests actual `nextLoad` source bytes below
  the moved package root;
- keeps DU absent from root/default/public-subpath claims while loading the
  actual physical `node_modules/virtual-bash/dist` implementation;
- makes every external command a bounded detached POSIX process group, retains
  raw stdout/stderr/status, handles ordinary failure, timeout, SIGINT and
  SIGTERM cleanup, and proves root/group plus reported grandchild closure;
- checks the complete materialized frozen file inventory before cases, in all
  finalization paths, after the child, and after successful scratch cleanup;
  successful cleanup requires actual `ENOENT`. Mutant copies are admitted
  before copy and individually removed with `ENOENT` evidence.

The admission controls contain forbidden path strings only in memory and prove
zero archive creations, writes, or extractions; they do not create or copy an
`AGENTS.md`. The old unsafe migration harness is neither present nor invoked.

No material frozen trust, safety, assertion, or sensitivity defect was found.
Admission does not pre-judge replay outcomes and makes no O060, three-ordering,
full-native, public/default-DU, GNU/Linux, whole-gate, deployed-provider,
superiority, or completion claim.

Permanent history is unchanged: old refined-v2/pre-v3 bytes remain
unrecoverable and the exact delta permanently unproved; old 22-fail/10-pass raw
evidence and old33 qualification remain; the prior 15-copy `AGENTS.md` incident
and guarded commit `b1b5abe972bbfc2feffbf04b8c2c98f324391923` remain recorded.
