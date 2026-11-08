# Independent repair verification: HARNESS HOLD, not product rejection

August 28, 2026. Different independent verifier, not the repair author.

**The complete stored-tree/path transport repair is demonstrated for the declared
strict-UTF8, sealed-inventory profile. Unqualified harness acceptance is withheld:**
frozen C18 dynamically fails at the capture-reader boundary, P28's raw-byte
profile is unsupported, and seven full recipes remain NOT_RUN/SOURCEONLY.
This is not evidence of a controller bypass or a product failure. No actual
future GO is issued, and no runtime controller was dispatched.

## Exact identities

- Repair source/preseal: `d8cbb7d76459e14d20f57e19f7c01ce04fa08702`.
- Author DATA evidence/report: `d3817018efd58d7a6e319192ef388aff7c9cc2cd`.
- Product source: `58be2d6c5706f3e90f01d48e695ecfd9daa52669`.
- Product evidence: `767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5`.
- Author execution-seal SHA256:
  `c05afd4ca977cc32e81d0ea4cff9311b44e6475a72c54ebf7bcdba7f47a2b116`.
- Independent original206/preseal8: `7d7e322b7e11fdc2ded4b5a4708da2e0aedad65b`.
- Independent initial runner preseal: `6978a89c75284b9e7e0efb125fef7a6b78ee8572`.
- Initial evidence/qualification: `655bfba4` (full object identity is in FINAL.json).
- Corrected runner preseal: `9f9fca99bb96e35a409c23ae3bf9349238184557`.
- Corrected independent RUNNER-SEAL-V2 SHA256:
  `eb54714b839dc31bc31a2a51f0f993c2975bc7e2d0e389c279c9aae304cd14dd`.

Actual candidate source bytes were checked against the explicitly named committed
Git blob OIDs and modes, not incidental HEAD. Author seals, 31 historical inputs,
old actual captures, all original8 files, new runner/source/tool inputs and tool
directory entries were authenticated. Corrected-run before/after checks cover
672 files and 28 directories (700 bindings), with matching SHA256/modes/sizes/blob
OIDs and directory names. This is exact inventory-v1/tool-directory append checking,
not an append-proof claim for the whole repository or additive report/run areas.

## Denominators, including the verifier's failed preparation

| Cohort | Actual disposition |
| --- | --- |
| Author DATA suite | Author reports65 PASS, authenticated as committed evidence; not independently replayed |
| Original independent preparation |206 frozen controls including98 actual identities;12 historical source/19 data/21 consumer sites; three preparation metadata children; no candidate execution then |
| First independent attempt |Corrected79 dynamic:78 PASS, P28 UNSUPPORTED;127 NOT_RUN, of which120 fixture-preparation blocked |
| Corrected independent attempt |199 dynamic:197 PASS, C18 FAIL, P28 UNSUPPORTED;7 NOT_RUN/SOURCEONLY |
| Historical actual-v1 |Original25 DATA /68 NOT_RUN unchanged |

The first attempt is preserved in review-01.json and its separate committed
REVIEW-01-QUALIFICATION.md. The reviewer's permission argv omitted descendants of
the unique work directory. H001-H098/C01-C21/M02 never reached their intended
entrypoint. The initial runner also incorrectly called21 preparation errors
negative passes. Those are explicitly invalidated, not author regressions.
Only additive v2 files corrected the grant and permission-error classification;
all original expectations, first runner and receipt remain intact.

review-02.json has one distinct record for each original control. No denominator
is inflated by duplicate attempts. All H001-H098 now PASS through actual
readCapture, parseTree, treeHash, full-census lookup and verifyProjection. The
imported bodies are the committed real DATA modules; no expected-root stub,
copied author parser, author control driver or controller substitute was used.

## Exact remaining harness issues

**C18 — capture-reader finite-file boundary.** The unchanged frozen input contains
five referenced fragments plus a sixth unreferenced duplicate record. Fixture
packaging faithfully writes that sixth record as an unreferenced file. Actual
readCapture returns the126-byte body with digest
`d4a03c710d81a7fe4e318a143221cb29fbe786750d00d09890efbadf79a93b56`, despite the
frozen expected rejection. It enumerates receipt references, not directory files.
All other C controls pass in the corrected run.

This is a **helper-local failure, not a demonstrated reachable controller bypass**:
controller checkHarness checks the exact inventory-v1 directory name census before
reading its sealed candidate capture. The separate full-boundary guard is reviewed
as source but deliberately not dispatched. C18 remains FAIL, not silently turned
into PASS or a new malformed receipt-schema requirement. Before unqualified
acceptance, the owner must either close this concrete consumed-capture boundary
or provide independent concrete evidence for the existing composed append gate,
with root explicitly accepting the narrower helper contract. Any implementation
change needs a new exact source commit/seal and a fresh independent DATA preseal.

**P28 — explicit domain gap.** Invalid UTF8 bytes are refused, while the frozen
raw-byte profile expects preservation. The author already declares fatal UTF8
and byte-roundtrip scope; P29 refusal PASS is not P28 support. Root must explicitly
decide whether that finite strict-UTF8 profile suffices. Otherwise a raw-byte
transport extension and fresh review are required. No silent scope reduction.

**Seven unexecuted recipes:** P30 nonrecursive040000/tree is unreachable in the
recursive-leaf consumer; B12 OID request construction, D02 unsupported stored
claim, M03 count assertion, M09 full append gate, M10 bodyless-stub integration,
M11 all-route replacement remain sourcequalified. No standalone exported DATA
entrypoint represents their complete recipes. Static findings are not counted
as executed rejection controls. SOURCE-REVIEW maps every one of the21 historical
sites to repaired functions, fixed-path behavior or retired/unreachable scripts.

## Complete tree and object proof

| Identity | Exact result |
| --- | --- |
| Stored candidate root, all50002 entries |`189bef24a927241d7c47a662f1ac447b56da1835`|
| Stored base root, all37412 entries |`2b8110a17559ba1ddbc94b9b8ac619e9dda00d40`|
| Five-override derived base |`8437e4eda904e1248c25eeef0d9d455b1d251495`|
| Derived base plus six candidate additions,37418 entries |`f761c0e1d7a1df48236da38ad78a18cf00a4813c`|
| Historical incorrect candidate root, rejected |`bd69c1a1dd0e65e442017ab27f86ed72a284fa95`|
| Frozen synthetic two-leaf derived root D01 |`6a328474bf7bcb7058e2846b7ac14d6eb3893583`|

The complete candidate raw body is7695763 bytes, SHA256
`2648f28efa3a98f6d5dd4e1cd890001a2d287dfb0573304e11dbe61e58c6f689`.
Independent preinspection reference reconstructs4911 directories. Its449-byte
root payload equals authenticated stored bytes directly, SHA256
`c5b4e6fc1e54133ecb5851d12f87c04ae5ab56aa58134247dfd50bc81978a7e0`.
Actual treeHash matches that independently frozen root; it exports only hashes,
so no fabricated actual-encoder payload capture is claimed. Each H control also
checks its original reference directory payloads/root and exact path/mode/OID.
The complete special98 ordered identity list equals the independent ACTUAL98
reference, with normalized identity-list SHA256
`46d48cf138d0e8c7601fad52e1289f914c1fc5291eb789eb01ddea3610dec0e3`.

D04 consumes the original2475165-byte/38-fragment batch body (SHA256
`80e819e2e1ee4ddcafb20cfc2ddc35566c80b51b45b3d8ed1aa6303b863f4958`) through actual
OID-bound batchObjects:276 objects,274 unchanged selected path/hash/length/blob
bindings, five authenticated overrides. Full base capture equals the original
5554546-byte/85-fragment capture (SHA256
`d158f9bf8f6d0a18053939105fa92387a0f7ab766ea94f2fb42246a3c4f29fe5`).
Stored candidate/base/evidence commits are authenticated from actual bodies.
No Git object-existence request is made for derived8437 or the derived combined
tree. No instruction contents or product source plaintext snapshots are persisted.

## Bounds, future launch interface and scope

The two bounded launch attempts span18:25:40.504Z–18:27:23.711Z on August28,
103207ms total, including correction/preseal coordination. Actual DATA children
closed in2947ms and5329ms under30-second limits; launch metadata children in32ms
and31ms under10-second limits. They run serially with strict unhandled rejections.
Two freeze stages each used four serial10-second development metadata children;
the launch stages added one each (ten), separate from the original three preparation
metadata children. Final evidence authentication adds two serial metadata children,
recorded in FINAL.json. Interactive Git status/diff/commit tooling is separate.

Launch raw captures total228370 bytes; corrected synthetic files total115160 bytes
in322 files, all removed. Final delivery records retained-file/capture accounting.
No512MiB work/128MiB capture cap is approached. Source/tool hashing reads are
reported as cumulative read bytes, not simultaneous working memory or RSS.
No global CLI process peak is invented. Exact child receipts show completion;
there are no persistent workers, services or owned temporary directories left.

The worker, bootstrap, loader, guard-control and deadline remain byte-identical to
actual-v1; seal jobs/counts/bounds are equal. Supervisor's only functional delta is
raw stderrBase64, not a new product permission. Full future package882, selected274,
app/loader/worker/read-permission argv, child capture and110-minute/70-job recipe
remain source-only. Compiler/build/install/product/runtime/controller/native/
network/mutant dispatch count is zero. No built-JS hashes are known or fabricated.

Future emissions remain derived from the sealed selected source/config/tool
recipe, then full BUILD-RECEIPT package/emission census and exact concrete
app/loader/worker/mutation bindings, committed RUNTIME-SEAL before RUNTIME-START.
Root must resolve/explicitly scope the two issues and unexecuted boundaries above
before any fresh ROOT-GO tied to the actual execution-seal SHA256. No GO, package
acceptance, product parity/superiority or completion claim is made here. Original
product SOURCEONLY concerns and historic nonexecution gaps remain separate.
