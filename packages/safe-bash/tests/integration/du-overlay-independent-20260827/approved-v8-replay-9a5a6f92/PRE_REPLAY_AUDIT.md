# Independent v8 pre-replay audit

Date: 2026-08-27

Decision: **ADMIT THE EXACT FROZEN V8 REPLAY.** This is a bounded static
judgment only. No candidate or native semantic case, product build, regression
test, package operation, installation, or consumer execution occurred before
this checkpoint.

## Authenticated immutable inputs

- Candidate commit `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d` resolves exactly,
  with tree `62c1b2f2784ca465b17d4b15a5736c42b8bdcf2d`.
- Freeze commit `ae0f8b3f4f927b06718fc51e176ca7a54b517364` resolves exactly,
  with repository tree `bf0d08a7a5640a1cb8aa0d1871d0b68d89cfc170` and fixture
  tree `8c845070afd27a3be5038b50d222f36dd9178838` at
  `tests/integration/du-overlay-independent-20260827/approved-v8-9a5a6f92/`.
- `MANIFEST.json` is Git blob `8c57cf22913c922ca11b3773f1748aaf184aa44a`,
  SHA-256 `e8f957bd9ea434b0af5388ab0e2ed2d936d5338fcbca5344f3793b08e5e38af7`.
  Its 21 ASCII-ordered non-self records plus the manifest cover exactly 22
  regular files. Every path, byte length, SHA-256, Git blob and `100644` mode
  matches the immutable tree; there are no additions, omissions, nonregular
  entries, or `AGENTS.md` paths.
- The selected candidate list is 7,522 bytes, SHA-256
  `9427aad46a7f184d94517a666ab02a8f1da43ccf9074c5a15186d4569233679b`.
  It resolves in exact ASCII order to 249 unique safe regular `100644` paths
  in the candidate tree, with no forbidden path. The independently generated
  stream of `path, mode, blob, bytes, SHA-256` records has SHA-256
  `9dfec95a9e32c8156115e26b9ea4b48f5602dc2e44262ffe2fe72f5185d00fb4`.
- The native oracle was read but not executed. Its realpath is
  `/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du`,
  mode `0755`, and SHA-256
  `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`,
  exactly matching the frozen GNU coreutils 9.7 identity.

## V7 provenance and exact V7-to-V8 delta

The base v7 commit `a08227b95b5ac3fc9175df6ca90a7700e5bdcbf4`, tree
`fbb92bc99161b52f4afdbdf2587f52f47e662d7e`, fixture tree
`cccd2d7693a10ac7609aa35db883b0530320383f`, manifest blob
`d2d09ec66ea193d7b39d2d6e0bc018f8986d8511` and manifest SHA-256
`ae6c2dac28f30e94a6a4d07060cad8506608b5ec5aabeed254c964fd678c3ffc`
all authenticate. Its audit commit
`d6814492a9de79c4f11b16956293afa14acc6fc0` and rejected evidence commit
`94c3fcd1e2663597fc57ebf5afd2ccf708add9ea` resolve exactly. The v7 evidence
manifest, report, failure analysis, and raw fresh-suite stdout/stderr match all
Git blobs and SHA-256 values declared by `ORIGINS.json`.

The complete classification is accurate: 14 inherited files are byte-identical;
six files are modified; `CORRECTION_V8.md` is the sole new non-manifest file;
and the self-excluded manifest is regenerated. The executable delta in
`harness/verify-v5.mjs` is only V5-023. `replay.mjs` and `verify-freeze.mjs`
change only the frozen relative path from v7 to v8. The remaining changed
files are documentation/provenance and manifest records.

The immutable v7 evidence confirms original 24/24, fresh 39/40, nested
environment 16/16, 19/19 metadata/DU records with 17 visible authorized
directory-atime deltas and zero unauthorized deltas, all four ordinary
positive controls, and all seven negative controls. V5-023 alone lacked an
old-file-atime precondition and observed no delta; V5-024 proved the host could
observe both the authorized directory-atime and rejected file-atime deltas.
Later phases were unexecuted. This audit does not rewrite that rejected run.

## Assertion and sensitivity audit

The approved measured contract is implemented literally. Metadata and DU
windows reject mutation and content reads, compare byte/entry projections, and
record complete normalized lstat objects and every changed field. A delta is
authorized only when it is directory `atimeMs` and the action log proves an
exact same-layer, same-path `readdir`. The authorized effect remains visible.
Stat/lstat and observer-only windows receive no allowance. File atime, mode,
identity, ownership, size/allocation, links, mtime, ctime, birthtime, bytes,
entries, upper removal and copy-up remain checked.

V5-023 first creates only an lstat inventory, forces and retains the old-atime
setup, re-samples by lstat, and requires the actual pre-read atime to equal the
forced value and precede mtime. It then performs exactly one real-adapter file
read outside product action, records complete before/after objects, requires
the locked 1,500-byte payload hash, and requires exactly one delta: `real`,
`/file.bin`, file `atimeMs`. The union-field delta assertion plus the explicit
non-atime comparison rejects every other field change. There is no retry or
pass-seeking fallback.

V5-021 proves directory-listing atime, V5-022 proves lstat stability, and
V5-024 independently proves forced-old root/file atimes before requiring one
authorized same-layer root-directory atime and one rejected file-atime delta.
The V5-025 through V5-027 non-atime-stat, byte and entry controls remain
unchanged. The v7-to-v8 diff changes none of these neighbors.

The frozen environment fixture contains 16 unique rows and reconstructs 1,500
bytes with SHA-256
`b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809`.
It covers default, selected valid, selected invalid, selected empty, valid
explicit override and invalid explicit `-B` across
`DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`. Invalid or empty selected values
default immediately and do not consult lower keys. Invalid explicit `-B`
must fail before virtual filesystem calls. Candidate and native drivers share
the literal expectations; native rows sanitize ambient keys and record actual
cwd for every spawn.

## Replay protocol audit

The inherited v7 protocol remains byte-identical except for its frozen path.
It resolves full revisions; authenticates the complete freeze and selected
candidate inventory; rejects forbidden paths before every archive extraction
or copy; and exercises zero-write forbidden-inventory and invalid-packlist
controls. It runs `npm pack --dry-run --ignore-scripts` before the package
archive, proves no tarball was created, admits the complete plan against the
hashed build inventory, compares the actual record and tar listing before
unpack, and rejects any changed packed bytes.

The package must have zero production, optional, peer and bundled dependencies.
The sole hashed local tarball is explicitly admitted before the offline,
scriptless install. Consumer inputs are admitted before copy; the installed
consumer is physically renamed; complete packed and installed inventories
must match; strict NodeNext uses `skipLibCheck: false`; runtime and moved-suite
execution bind to physical `node_modules/virtual-bash/dist` files; and the
loader records actual `nextLoad` byte hashes. DU is intentionally absent from
root, public subpath and default aggregate claims.

Every external command uses a bounded detached POSIX process group. Ordinary
failure, timeout, signal shutdown, root/group closure and an actual grandchild
timeout control are recorded. Raw stdout, stderr, status, literal argv, cwd,
timing and closure metadata survive failure paths. Frozen path/byte/SHA/blob
inventories are checked before cases, in finalization, after the child, and
after successful cleanup, including new-entry detection. Each mutant copy has
separate admitted-copy and `ENOENT` cleanup checks; successful replay requires
owned scratch `ENOENT`. The runner does not contain or invoke the old unsafe
migration audit.

No material frozen trust, safety, assertion, or sensitivity defect was found.
Admission does not pre-judge execution. It establishes no O060 behavior,
three-ordering native result, GNU/Linux semantics, broad native parity,
public/default DU, deployed-provider behavior, whole-gate result, superiority,
or completion. The unrecoverable refined-v2/pre-v3 bytes and exact delta remain
permanently unproved; old raw evidence, the later 33-case qualification, and
the prior temporary-`AGENTS.md` incident remain untouched.
