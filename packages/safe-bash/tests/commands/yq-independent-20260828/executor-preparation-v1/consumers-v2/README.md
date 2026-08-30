# Consumer v2: selected-source admission correction

Prepared August 28, 2026. Author correction only; different-agent framework review and root integration remain pending. Product imports/runs/builds/type compiles/package replays: **zero**.

## Confirmed defect and preserved evidence

Original consumer commit: `409449136ae1adc252ff6e205a6bb5785d113d0f`. The authenticated original `guards.mjs:200` enumerates the whole candidate commit's selected broad paths, and line 208 rejects them against a separately composed source map. The raw original call with the root-authorized seven-path receipt exited 1 with `SOURCE_BINDING`, preserving stdout, stderr, stack, hashes and status in `raw-v1/REFUSAL.json`. The error is a harness source-origin mismatch, not a YQ failure.

The root composition is **not** the whole 35da commit tree: eight baseline entries differ there and thirty other entries are unselected. The original guard consumed 301 paths where the selected consumer source scope has 271. V2 does not import or accept those other features, require baseline ancestry, use mutable HEAD, fabricate another Git commit, or modify v1.

`PRESEAL.json` at `61cec1d71bf1121234de8ee727da990ff29c54e8` precedes reproduction and correction. `VALIDATION-PRESEAL.json` binds the implementation before validation. The only protocol revision after initial preseal adds the specification checker's missing Normative Language heading; original bytes remain in that commit, and no controls/policy changed. Final specification checking has zero errors/warnings.

## Exact correction

- All 264 original selected baseline entries come from `5137a74ec855a32d8a8860eb66b62eb44d11e290`, except the interpreter from `74361026502d76b8c2b696f9c60e410ac9b78d95`.
- The seven explicit new files come only from `35da18547ca82a67be9ca22b4adc21e3b8060780` and must match the root-bound author manifest at `ef6032b210feb5cf19e6f6f94c40413740bef335` in path, blob, raw-byte hash, size and mode.
- The caller cannot authorize new origins or replacements through its receipt. The exact sourceAdditions set is checked against `SOURCE-AUTHORITY.json` and the authenticated author manifest; missing or extra additions fail.
- The resulting sourceFiles map remains 271 entries. All remaining source-materialization, full-package, moved-import, TYPE-worker and public-gap behavior is unchanged. The minimal-diff checks compare all non-source-admission guard code and the full type worker after only explicit frozen-data plumbing substitutions.

## Interface and immutable v1 reuse

Use this directory's `guards.mjs` and `type-worker.mjs` together. The original API signatures, receipt schema 1, source authority result fields, explicit YQ/contracts entry binding, compiler status rules and CLI argument order are unchanged. `fixtureRoot` is an added harness-only export identifying authenticated immutable v1 data/fixtures; `preparationRoot` remains this v2 directory.

`frozen-v1.mjs` authenticates the original verifier by fixed SHA-256 before importing it, then verifies all 39 original recipe entries and its fixed raw seal hash. V2 reads v1 data/fixtures only through that verified root. It does not copy fixtures or open any product module. `verify-recipe.mjs` is byte-identical to v1 but verifies this v2 tree when invoked here. Root must authenticate its accepted commit/hash, then independently route the v2 seal digest before loading helpers:

```text
node tests/commands/yq-independent-20260828/executor-preparation-v1/consumers-v2/verify-recipe.mjs ROOT_ROUTED_V2_SEAL_SHA256
```

Future source-only admission, with no build or import:

```text
authorizeSources(receiptPath, independentlyExpectedReceiptSha256)
```

Source-only receipt keys remain exactly `schema`, `sourceBase`, `acceptedLength`, `candidateCommit`, `sourceAdditions`. Full receipts add exactly the v1 `packageAdditions`, `packageDirectories`, `entries`, `allowedBuiltins`, `buildReceipt`. `candidateCommit` is pinned to the root-authorized 35da origin in this version. No new receipt fields or caller-selected source overrides are accepted.

The future TYPE CLI remains:

```text
node tests/commands/yq-independent-20260828/executor-preparation-v1/consumers-v2/type-worker.mjs RECEIPT_PATH RECEIPT_SHA256 COMPILED_PACKAGE_ROOT NEW_MOVED_DESTINATION NEW_EVIDENCE_DIRECTORY
```

It is **not run here**. `assertWorkerExit` is unchanged: every nonzero worker child is aggregate failure. Expected nested compiler rejection is interpreted only inside the worker with its exact diagnostic fixture. Public root/package imports remain `PUBLIC_EXPORT_GAP`; direct module proof does not close that gap.

## Checks and honest boundaries

- `evidence/admission-4lTtwy/RESULTS.json`: **17/17** predeclared data/admission controls matched, including actual selected-source admission; no YQ semantic results.
- `evidence/synthetic-POfhb4/RESULTS.json`: **36/36** original synthetic controls matched with unchanged fixture inputs/outcomes. Scratch/evidence and imports point to v2; old v1 controls/captures remain intact.
- Minimal-diff checks confirm unchanged other guards, TYPE behavior, original control operations, and recipe verifier bytes. No public-export or builtin allowlist change is made.
- Raw source archive hash matches `e4e6880a3622952b153a8261fec007908e1495584abf705ba2b150e95badcedc`. Raw full-package hash matches `2942ba1f6982a2e217350bbbad420e93d43e9336324b6db8a3d1d88b5a7aee4d` **before** bounded in-memory data parsing. Nothing is extracted for execution or repacked.
- The complete package has the exact 846 baseline entries plus the 24 authorized outputs: 870 for this candidate. README remains 36273 bytes, mode 0644, SHA-256 `87e92b73c7339b104212a9fb11006d339694f65575a7b79debfaa902ef9cf9d1` from the fixed baseline, not the candidate's global root README.

The 273-member source archive additionally carries baseline `package-lock.json` and `scripts/typecheck.mjs`; those two exact origins were authenticated as archive data. They remain **outside** the unchanged 271-member source-materialization guard. Passing the entire 273-member extracted archive to that guard would still fail exact membership. Supporting the full archive there requires a separately approved explicit two-file scope change and review; v2 does not silently make that change or reroute a build.

The admission worker's current unsealed report was inspected read-only; it also reports a separate runtime `node:timers/promises` allowlist issue. That report is not used as authority for this correction, and the runtime fence is not modified or claimed resolved here. All actual runtime, compiler, moved-product, public-export and independent source-to-output proofs remain deferred.

The root must route additional material changes separately. No sandbox, hard-RSS, filesystem transaction, adversarial change-and-restore detection, product acceptance, or author self-approval is claimed.
