# SI-MODE-01 exact namespace correction and type-source review

Status: Proposed additive harness projection; target execution UNRUN
Implemented Through: Not applicable to actual target execution
Purpose: Correct the already declared MemoryFileSystem stat representation without changing fixtures or product semantics, and report a different static review of the type-API packet.

## Mode correction

Original semantic commit `656c49fef410b51b85bd905a7824d80c2a0c7a9e` and integration commits `c3d8a8578b9e83af9b16fb85d553f05a66d5a534` / `b57b45b7461cb133863f6b0a97e8fdcf7fc8cf3b` remain immutable. The original SI-MODE-01 remains an **unexecuted source contradiction**, not a measured product failure or rescored cohort.

Selected Memory source `67eab12e315054907ef4ef435c6bbca2f59e0c36`, blob `29551d4afa95503783f915410fcdafaf518a6786`, defines type masks at54, directory creation at133, raw stat mode at234 and file creation at268. A declared0644 file has full mode0100644 (33188), not permission-only0644 (420). Root and every directory in the sealed fixture construction use0755, yielding full directory mode040755 (16877).

Exactly two original source spans change:

- Line132: expected file mode becomes `0o100000 | file.mode`.
- Line134: the existing directory-type predicate also requires `row.mode === 0o040755`.

No observed stat is masked, rewritten or normalized. No path/content/ordering/status/stdout/stderr/command/actor/cleanup code changes. There are still104 cases,56 in-case controls/profile,208 S/M records and at most320 command invocations. Original manifests, helper, generator, data and expectations remain byte-identical. DERIVATION.json binds the original source, every unchanged byte segment, the two exact replacement spans, and the complete postimage. MODE.patch.data is an **unapplied data proof**, not permission to patch the original working tree.

## Exact runner substitution

1. Authenticate the immutable semantic inputs and this new committed packet before materialization. Treat the old semantic seal as a historical input identity, not as the final assembled-code map.
2. Copy this directory's `semantic.mjs` into the isolated harness assembly at **`semantic/semantic.mjs`**, regular0644. It is18613 bytes, SHA256 `0f8e4b79ec3cf233b9b31a166f83feef264384a62039417ef2f0e049f899da7f`. It replaces only the active assembly actor previously18577 bytes / `016378caa896457d1c4fc2852fe49d6c18b02e65b567dfaad88e6672cf4c64f2`.
3. Keep `semantic/fixtures.mjs`, `semantic/CASE-DATA.json`, `semantic/FROZEN-DATA.json`, CASES and BATCHES from the exact original commit. Their path/hash/size bindings are in DERIVATION.json. Freshly authenticate active projections' physical modes; stored Git modes do not attest historical host POSIX permissions.
4. Seal the compound active-code map with this one explicit replacement. Do not broaden exclusions, mutate original source/data/seals, or call an unchanged old whole-map check an assembled-map proof.
5. Keep the existing `async runCase(api,caseId)` ABI and CASES entry `semantic/semantic.mjs`. The actor's unchanged `./fixtures.mjs` import resolves in that assembly directory. **Do not import the source file in semantic-mode-v3 directly**; the absence of copied local data/helper is deliberate, not a fallback opportunity.

Imports remain node:fs/promises plus the original helper; its transitive builtins remain node:crypto and node:zlib. Existing explicit api.load entries and source/package authentication are unchanged. This correction adds zero cases, controls, children, compiler calls or time windows; only36 actor source bytes. Existing reservations and absolute caps apply. No new allowance, targetGO, root export or public-package claim is introduced. Safe ordinary assertion aggregation stays the separately routed runner obligation, not a change here.

## Different static type review

Reviewed source `10186980049dee95c062f88b2ae093962c8f328e` and evidence `33775a17d315d469aa8817c2421e3b6077b3e0b7`, authored by the mechanical owner, read-only. TYPE-REVIEW.json binds seven source modules, relevant manifests/specification, and the five original fixture blobs. Seven source bodies match the evidence commit; all five template bytes and four negative diagnostic intents match the original.

**No source contradiction found in the requested type-protocol scope.** The result has no fake CLI exit fields. T01 remains positive; T02/T03 retain forbidden-property TS2353; T04/T05 retain wrong-type TS2322. Exact primary diagnostic count/file/code/category/line/column/message and declared related-information handling reject missing-module or warning substitutes. Normal strict ES2022/NodeNext options and explicit typeRoots remain; compiler reads use the admitted snapshot without host-file fallback. This is not a VM sandbox guarantee or observed compiler resolution.

Raw is published before the diagnostic predicate. An API negative is diagnostic data, not a waived nonzero child. Mismatch, throw, capture overflow and unsafe outcomes still fail. Parent requirements explicitly keep actual worker status/signal/timeout/stdout/stderr/timing/reap separate and reject nonzero before returning the API result. The old CLI-result ABI must not be silently reused.

Combined-seal prerequisites, **not verified as implemented here**: exact v2 transport; trusted outer startup capture before fallible admission (worker admission precedes its internal try/raw publisher); exact copied tools/full910 subject/request/fixture/active closure; raw/result and strict-root binding; known reap/full postguards including additions; all ten wrappers and ten compiler-API child starts inside existing budgets. No peer file is changed. Actual compiler/API/type/target proof remains UNRUN. PUBLIC_EXPORT_GAP and existing S02/H09 qualifications are unchanged; no resource research is performed.

## Validation state

Only source reads, stored Git identities, literal source derivation, JSON/base64/hash comparison and exact owned-commit checks occur. No authored actor/helper import, patch replay, namespace/control run, syntax child, compiler, API, product, native oracle or old checker executes. This report is coordination/provenance evidence, not a new product specification; no spec checker retry is performed.

The source projection is authored, not independently accepted by this author. Root routes the combined committed preseal and any further independent review before the already bounded actual activation. No expansion or actual run follows this checkpoint.
