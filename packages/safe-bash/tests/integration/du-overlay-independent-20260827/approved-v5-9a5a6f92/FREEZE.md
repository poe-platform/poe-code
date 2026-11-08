# Fresh v5 DU/Overlay fixture freeze

Authored on 2026-08-27 after candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`, authenticated current-fixture
commit `66975ea8ffeedd7c1df510bac2b13e1767bef610`, and the root-approved atime
diagnostic `75b39b40396e68a27121eea9ca2d31c67dee4e9e` had already been created and
inspected. The author read the GNU oracle identity at 2026-08-27T19:22:08Z.
The v5 author did not run candidate or native semantic cases before this freeze.

## Scope and lineage

This is a fresh, recoverable fixture version. It starts from authenticated
current-v3 bytes and freezes every v5 input before replay. It is not evidence of
the unavailable refined-v2 bytes and does not reconstruct or guess them. The
v2-to-v3 exact delta remains permanently unproved. The preserved old 22-fail /
10-pass capture and later corrected 33/33 report remain historical and retain
their original qualifications; this tree does not rewrite them.

`harness/verify-original.mjs` is the byte-identical historical 24-case suite and
is reported separately. Its historical wording is not the fresh v5 metadata
contract. `harness/verify-v5.mjs` retains exactly 31 historical frozen-derived
case records and two post-freeze lifecycle case records, all newly frozen here,
then adds seven observer-policy controls. The 16 environment rows remain one
non-overlapping v5 case record with complete row evidence. No aggregate here is
added to author-reported or whole-project cohorts.

The candidate source/test archive uses the exact 249 file paths in
`config/candidate-selected-paths.txt`. DU is loaded from the physical installed
`node_modules/virtual-bash/dist/commands/du/index.js` path and manually
registered for consumer checks. This does not claim a root export, public DU
subpath, default `agentCommands` registration, O060 coverage, whole-gate
coverage, deployed-provider coverage, or broad native parity.

## Root-approved measured contract

The product action must issue no explicit mutation or content-read operation,
must not copy up, and must leave backing bytes and entry sets unchanged. The v5
verifier performs byte and entry enumeration outside the measured action
window. It takes lstat-only snapshots immediately before and after the action,
records complete normalized `FileStat` objects and every changed field, and
requires mode, identity, ownership, size, allocation, mtime, ctime, birthtime,
link and all other non-atime fields to remain exact.

Only a directory `atimeMs` delta for the same backing layer and path on which
the action actually called `readdir` is authorized. It is retained visibly in
the result. `stat`/`lstat` must preserve atime. File-atime and non-listed
directory-atime changes are rejected. Real-clock real-adapter controls prove a
directory listing atime change, lstat stability, and an observer-only file-read
atime change outside the product phase. Real mode, byte, entry and file-atime
scope mutants exercise the unchanged assertions. Existing upper-removal,
content-read and copy-up mutants are also retained.

The fresh table locks a 1,500-byte apparent-size payload and literal expectations
for `DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`: valid selected values, invalid and
empty selected values falling directly to default units without lower-priority
lookup, valid explicit `-B` override, and strict invalid explicit `-B`, for all
three selected variables. `BLOCKSIZE` has no invented lower-priority key. The
GNU run is restricted to this single-file apparent-size table and preserves raw
stdout, stderr and status with an honestly narrow classification.

## Protocol and guards

Replay takes two explicit 40-character commits and never resolves `HEAD`.
Before any archive write it resolves and admits the complete frozen and
candidate inventories. Before every extraction or recursive copy it rejects an
inventory containing an `AGENTS.md` basename. The executable negative admission
control uses only an in-memory forbidden pathname and verifies zero writes; it
never creates that file. The npm tar inventory is admitted before npm-package
extraction and the frozen consumer is admitted before copy. The prior temporary
copy violation remains permanently acknowledged by project history; it is not
repeated here. The old unsafe audit is not invoked.

The runner builds the isolated selected candidate source, runs the separately
labeled original and v5 suites from source, runs the exact four named DU/overlay
regression files, packs the actual package, installs then moves a consumer, and
runs the same suites against the physical moved installation. It checks strict
NodeNext with `skipLibCheck: false`, complete package hashes, loader
`nextLoad` source-byte hashes, wrong-root and missing-DU guards, the restored
cleanup behavior mutant, and a syntactically valid undeclared-type declaration
control. It verifies candidate/frozen inputs before and after, preserves failed
runs in the root-chosen versioned result subdirectory, checks child/PID and
foreign-index closure, and removes only authenticated scratch on success.

## Immutable verification and replay

After the freeze commit is known, perform static byte verification only with:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v5-9a5a6f92/verify-freeze.mjs FREEZE_COMMIT
```

The different audit/replay leaf must first audit every new assertion and then
execute, choosing a new result subdirectory outside this frozen tree:

```sh
node tests/integration/du-overlay-independent-20260827/approved-v5-9a5a6f92/replay.mjs \
  FREEZE_COMMIT \
  9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d \
  /Users/kjopek/Workspace/safe-bash/tests/integration/du-overlay-independent-20260827/RESULT_SUBDIR_CHOSEN_BY_ROOT \
  /Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du
```

`MANIFEST.json` lists every non-self frozen byte with size, SHA-256 and Git blob.
The freeze commit binds the manifest itself. Runtime re-materializes this exact
tree from that commit and refuses mutable or incomplete inputs.

## Permanent limits

The original verifier blob `f127f231fe53392ed3635af1c255b66526b5c485`
is unavailable. No claim is made about its exact transition, GNU/Linux behavior,
O060, native three-operand ordering, whole-repository acceptance, or full native
parity. Root wiring remains unchanged. This author stops at the immutable freeze;
all semantic acceptance belongs to a different leaf's later audit and replay.
