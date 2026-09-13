# Bounded image extraction

Scope: F35 in `docs/specs/pptx.md`, using the shared office CLI/SDK contracts.
This task does not execute the whole pipeline, push, release, edit README files,
or modify pre-existing image replacement work.

## Ownership and implementation

- Engine delegate owns `packages/pptx/src/image-extraction.ts` and its original
  in-memory tests and shared selection admission validation.
- Adapter delegate owns extraction publication in the scoped safe-bash command
  and fast memfs/Shell tests, under that package's delegation rules. This owner
  also integrates the package command engine and schema; root owns staging.
- Accounting delegate owns this plan and new extraction receipts in `docs/pptx`.
- Root runs maintained checks, integrates explicit owned files, and commits each
  atomic improvement on main after checks pass. Local hashes are reported
  separately; no remote delivery is authorized.

Use TDD: first reproduce missing extraction behavior with failing original cases,
then implement. Independently compare exact emitted bytes and SHA-256 values;
never calculate expected output through the implementation under test. Default
occurrence extraction retains duplicates. Unique extraction is explicit and
preserves every contributing occurrence in the manifest. Selectors apply before
grouping. Read notes/layout drawings without creating or mutating them.

## Manual QA procedure

1. Use only existing disposable inputs listed in
   `docs/pptx/corpus-manifest.json`, starting with the IXPE presentation template
   and, if useful, the listed CERN deck. Verify each exact cached file's SHA-256
   against the manifest before admission. Missing inputs are unavailable cases,
   not passed checks. Never download from a unit test.
2. Admit bytes explicitly through the SDK with suitable declared QA limits.
   Extract slides, then explicit notes/layout/shared scopes where present.
   Compare each output byte array against its independently opened ZIP member;
   compare recorded SHA-256 against Node crypto over the original member bytes.
3. Compare occurrence and explicit unique output cardinalities; ensure grouping
   does not remove source occurrence provenance. Repeat the same operation and
   compare names and manifest order. Check a selected image/hash subset.
4. Exercise `pptx images extract` through the actual Shell against a disposable
   VFS directory. Inspect its JSON manifest and directory contents. Existing
   outputs must fail without force; transaction failure must publish nothing;
   explicit partial mode must identify only successfully published files.
5. Inspect the CLI screenshot where the maintained screenshot route can invoke
   the command. Do not render extracted SVG or activate any media. Extraction
   QA establishes byte preservation and publication behavior, not visual fidelity.
6. Reduce meaningful findings into tiny original in-memory regressions before
   claiming resolution. Record exact evidence in the extraction receipt. Keep
   acquired binaries and generated QA outputs out of Git; do not delete unrelated
   cache files.

## Verification receipt

Maintained checks and disposable-corpus results are recorded after execution in
`docs/pptx/image-extraction-evidence.md`. The machine-readable case ledger retains
individual source parameter/example identities in research only. Adjacent model
APIs and prior implementation work are not counted as extraction parity.
