# V8 correction rationale

Date: 2026-08-27

This is a new recoverable static fixture version for exact candidate
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`. It corrects one positive-control
setup/measurement defect demonstrated by the first actual immutable-v7 replay.
It does not modify v7 or its evidence, turn that rejected replay into a pass, or
establish a candidate product defect.

## Immutable failure evidence and chronology

The base is v7 commit `a08227b95b5ac3fc9175df6ca90a7700e5bdcbf4`,
fixture tree `cccd2d7693a10ac7609aa35db883b0530320383f`, 21 files,
manifest Git blob `d2d09ec66ea193d7b39d2d6e0bc018f8986d8511`, and
manifest SHA-256
`ae6c2dac28f30e94a6a4d07060cad8506608b5ec5aabeed254c964fd678c3ffc`.
The independent v7 pre-replay audit is commit
`d6814492a9de79c4f11b16956293afa14acc6fc0`. The later failed replay/report is
commit `94c3fcd1e2663597fc57ebf5afd2ccf708add9ea`, tree
`c824d899133549e2c97734c48e4d109f637f5681`, with evidence-manifest Git blob
`585cd7091b210db2cdf6a52ad3f80fa0ab1d6030` and SHA-256
`ae22912f0ffbc2c198bc92ee2568603c2604365f48ca928b9a325d8a0442f87e`.
This v8 correction is therefore post-candidate, post-v7-audit and
post-v7-failure, but pre-v8-replay.

The exact raw failure is preserved at
`approved-v7-replay-9a5a6f92/replay-001/run-2026-08-27T201138968Z-8e1ed2/FAILURE_ANALYSIS.json`
(Git blob `2d8fc8308623dfc0a588f9d179977e150b454352`, SHA-256
`d8016deb81736a4e18d189fc0d887b12366d7ecbfee11f077a5cb41afeb0b819`).
The complete fresh-suite stdout is the adjacent
`all-processes-raw/057.stdout` (Git blob
`a3836b1e5ed58728f06fc26b32e5e7119316b280`, SHA-256
`902ba407c86363e9da3692453afb089941db06f9ea8675ef34e6ac98c91b0b4f`);
its stderr is Git blob `f159ace1ca6e65ea3f1c80f61f71e6df7bc64fa5`,
SHA-256 `a61a3b4dee83a90c7bdd225be86f20ff67fe7f44a21042ede3971a3517253150`.
The immutable report is Git blob `0922612003f6b10ba323b2763685662ed4e96567`,
SHA-256 `a19881f70e227729c0e970b929a4dcde097dda6dbddf17d3df0ae12652a81c61`.

Actual v7 results were original 24/24, fresh 39/40, nested environment
16/16, positive controls 4/4 except the separately classified V5-023
observer-policy positive control, negative controls 7/7, and metadata/DU
19/19 with 17 recorded authorized directory-atime deltas and zero unauthorized
deltas. V5-024 passed with one authorized directory-atime and one unauthorized
file-atime delta. Package, moved-consumer, scoped 128 and native stages were not
reached. All 109 roots/groups and the timeout grandchild were absent; owned
scratch ended at ENOENT. No product bug was established.

## Exact V5-023 correction

V7 V5-023 read the correct 1,500-byte payload but recorded file `atimeMs`
`1787861504449.238` before and after the read while `mtimeMs` was
`1787861504446`. Its supposed before sample was already newer than mtime.
Although it called `forceOldAtime`, it discarded the setup record and did not
assert that the old timestamp remained observable before the action.

V8 changes only this case's setup and measurement body in
`harness/verify-v5.mjs`:

1. inventory `/file.bin` with `lstat` only and perform no content read;
2. force the old file atime as fixture setup and retain the setup record;
3. sample the real adapter with the same lstat-only inventory and require the
   actual before atime to equal the forced value and be older than mtime;
4. perform the single observer-only real-adapter file read outside product
   phase;
5. capture complete post-read stats and require exactly one resulting delta:
   `real`, `/file.bin`, file `atimeMs`;
6. retain the payload hash and equality of every non-atime field.

There is no retry loop, pass-seeking fallback or weakened expectation. The
record explicitly labels the observer scope and lstat-only inventory.

## Direct-neighbor audit

V5-021 forces old directory atime before its measured listing and passed.
V5-022 forces old directory atime before its lstat-only stability window and
passed. V5-024 inventories with lstat only, then proves forced-old root and
file atimes before its read/listing mutant; it passed with the exact expected
two deltas. None performs a preliminary content read before forced-old setup,
so none has V5-023's root cause and none is changed. The V5-025 through V5-027
mutation controls also do not depend on an old file-atime read precondition.

## Complete relative-tree classification

`ORIGINS.json` classifies every v7 path as byte-identical, modified, replaced
by the regenerated self-excluded manifest, or new. It records every v7 size,
SHA-256 and Git blob. `MANIFEST.json` records every v8 non-self path's new size,
SHA-256 and Git blob, so the two files provide the complete old/new hash map
without a self-referential manifest digest. The only executable differences
are the V5-023 body above and path-only `approved-v7` to `approved-v8` routing
in `replay.mjs` and `verify-freeze.mjs`. Documentation changes are
`CASE_MAP.md`, `FREEZE.md`, `ORIGINS.json`, and this new rationale.

The original 24-case verifier, literal 16-row table, selected 249-path input,
oracle, consumer, loader, process manager, timeout control, native driver and
V5-024 bytes are otherwise preserved. Counts remain 24, 40 and 16.

## Preserved policy and history

Only actual same-layer directory `readdir` may authorize provider/native
directory atime and every such effect remains recorded. File atime and all
other stat fields remain forbidden in product windows; no atime field is
globally stripped. No explicit metadata/DU mutation, content read, copy-up,
backing-byte or entry change is allowed.

Environment precedence remains `DU_BLOCK_SIZE > BLOCK_SIZE > BLOCKSIZE`;
selected invalid/empty values default immediately without lower-key lookup,
and explicit `-B` remains strict. All 16 literal/native rows are unchanged.
Actual module paths remain allowed while public/default DU remains absent.
O060, the three native ordering differences and deterministic-root behavior
remain unchanged. No whole-gate or native-parity claim is made.

The unrecoverable refined-v2/pre-v3 bytes and exact delta remain permanently
unproved. Old 22-fail/10-pass evidence, later 33-case qualification, the prior
15-copy `AGENTS.md` incident, and guarded commit
`b1b5abe972bbfc2feffbf04b8c2c98f324391923` remain untouched. No such file is
created in v8 and the unsafe old migration harness is not run.

Only static syntax/parse, JSON, inventory, hash, Git-blob and origin checks are
permitted before this freeze. Candidate/native semantics, product build/pack,
install and consumer execution remain for a different leaf after an independent
audit of the committed bytes.
