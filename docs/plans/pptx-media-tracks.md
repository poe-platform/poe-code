# PPTX media track preservation

Scope: independently validated track schemas and safe media replacement. No full
pipeline execution, README changes, downloads, push or release. Work stays on
main and only specifically owned files are staged after maintained checks.

## Ownership

Coordinator owns package domain changes and integration. Research agent owns
`docs/pptx/media-track-schema-map.md`, `docs/pptx/media-track-case-map.json` and
this plan; it does not edit product code or commit. Other scoped owners provide
original SDK/CLI regressions under the coordinator's explicit allocation.
Safe-bash adapters remain in `packages/safe-bash/src/commands/pptx`; root only
wires exports. Preserve all unrelated edits.

## Evidence and execution procedure

1. Read root/scoped instructions, shared format/CLI/SDK contracts, both upstream
   audits/inventories, previous media ledgers and corpus manifest.
2. Confirm exact official namespaces, cardinality, language/label fields,
   relationship ownership, WebVTT cue-range distinction and media-trim units.
   Record research in the schema map; preserve source identities only in research.
3. Write fast original memfs tests before domain fixes. Independently inspect
   emitted ZIP XML/relationships/bytes, not just inventory snapshots. Cover two
   languages/labels, multiple tracks, missing optional language, cue ranges,
   odd filename extension with declared text/vtt, unknown metadata that shares
   a known relationship, nested MCE Choice/Fallback and orphan rejection.
4. Exercise public SDK and exposed plural media CLI operations, including failure
   publication/unchanged output. Compare common envelopes, schema/capabilities
   and stable exit categories; avoid a new track setter without validated scope.
5. Run maintained focused package tests/lint and any changed adapter checks.
   Inspect CLI screenshots if visible output changes. Record actual outcomes;
   never count a designed test or source mapping as passing evidence.
6. Commit atomic validated improvements with only explicit owned paths and this
   plan after successful checks. Report hashes separately; do not push/release.

## Current research receipt

Official schema research complete on 2026-09-13; publication index still shows
MS-PPTX revision 25.0 (2024-08-20). No source implementation/assets copied and no
new legal notice needed; existing standalone MIT notice retained.

Inventory consistency: 48 media unit variants and six BDD examples matched the
prior ledger exactly. No caption/track case identities exist in the pinned full
inventory. All 48 direct media API records remain retained, with four historical
enum-value receipts and 44 explicit live-model gaps; no new model API completion.

Manifest-only review: all 14 namespace censuses lack the 2017/3 track namespace.
No new disposable-corpus operation or playback/render validation ran. Original
fixture regressions are the evidence for this bounded change. Domain/test results
and local commit hashes are to be recorded by the coordinator after execution.

## Executed domain checks

Two alias regressions first failed because replacement succeeded. After the
validated binding guard, all four original SDK variants pass. The multilingual
case includes three tracks, an absent optional language, an inert external link
and a `.dat` target declared `text/vtt`. No cue values or opaque XML are edited.
An initial fixture assertion rejected the handcrafted ZIP writer version; the
test now reuses its original in-memory member map before packaging, preserving
the strict independent output assertion reader.

`npm run test --workspace=pptx`: 142 files, 3,823 tests passed.
`npm run lint --workspace=pptx`: ESLint and both TypeScript checks passed.
The final third-track assertion was rerun directly and passed (four variants).
Selected workspace build and actual virtual-shell evidence are recorded in
[pptx-media-track-cli.md](pptx-media-track-cli.md). Usage is drafted in
[media-track-usage.md](../pptx/media-track-usage.md); README is untouched.

## Commit gate blocker

Guarded `npm run lint:eslint` completed with exit 2 and `complete:false`.
It reached the fixed subject cap (`scripts/lint-input-guard.mjs`: 12,000):
12,001 configured inputs, 12,000 linted inputs, zero reported errors/warnings,
3,305,652 metadata operations. The last input was an unrelated agent-eval
fixture. This is an incomplete gate, not a passing lint result. No guard budgets,
input membership, safety checks or root infrastructure were changed to bypass it.
An earlier direct root ESLint invocation exited 0 but was outside the scoped
maintained invocation rule and does not count as gate evidence.

Maintained `npm run typecheck --workspace=virtual-bash` passed source/tests and
26 current consumer groups with expected negative cases and cleanup. Literal
registration checks passed 107/107. These successes do not waive guarded lint.

Local commits remain blocked by the incomplete maintained lint gate. All owned
changes are left reviewable in the worktree; no staging, push or release occurred.
The independently discovered package-root owner regression is handled separately
in [pptx-media-root-owner.md](pptx-media-root-owner.md).


## Follow-up namespace receipt

The coordinator reports the final 38 focused package tests and lint passing
after the root path guard correction. The known-track fixture now uses the
schema-correct `m:extLst/p:ext` nesting; unknown `m:ext` fixtures intentionally
remain opaque preservation cases. Official PDF section 2.2.4.1 confirms the
track extension URI and placement recorded in the schema map. Section 2.2.4
also exposed an existing media insertion GUID discrepancy, reported to the
coordinator as an independent schema finding; this research agent made no code
changes. No full pipeline, corpus download, push or release ran here.

## Final bounded result

Three independently validated fixes are ready for separate atomic commits after
the maintained commit gate is cleared: unsupported metadata binding aliases,
root-owned media relationship paths, and the registered authored media extension
identifier. The final focused package run passed 39 cases (five new track/schema
variants, 29 media editing cases, five command cases). Package lint and both
TypeScript configurations passed again on the final code. The final selected
workspace build and ten shell cases passed after exact URI fixture corrections;
registration and consumer typecheck receipts are in the linked CLI/root-owner
plans. The earlier 3,823-test full package receipt predates the additional
identifier case and is not mislabeled as a final full-suite rerun.

The identifier case was first red, then green; the command insertion test checks
its output independently. See [the separate identifier plan](pptx-media-extension-id.md).
No full pipeline was executed. No local commits were created, no files were
staged, and no push or release occurred. Unrelated work remains untouched.
