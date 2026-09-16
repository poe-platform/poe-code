# PPTX literal text replacement

Scope: implement F16 in `packages/pptx`, with safe-bash routing owned by its command adapter. No pipeline execution, README edits, downloads, push or release. Domain, adapter and provenance work are delegated to separate owners. Stage only named owned files after maintained checks pass.

## Contract and observed gap

The existing text reader provides structural text and selectors; preserving replacement was absent at the start of this work. Reproduce the missing operation with failing original SDK and CLI cases before implementation. Shared `office-cli.md` and `office-sdk.md` govern spelling, explicit cardinality, bounded selection, errors, schema and publication.

Match adjacent ordinary runs within one paragraph, preserving field, break, paragraph, cell and shape boundaries. Use exact case-sensitive Unicode text with no normalization, regex or locale folding. Reject empty search and malformed surrogate inputs; do not split surrogate pairs. Combining marks retain their original scalar sequence. Replace nonoverlapping occurrences in original structural order without searching inserted text. Empty replacement deletes the match. Inherit the first affected run's explicit style while retaining its inherited context; preserve unmatched run formatting, hyperlink relationships and unrelated part bytes. Explicit overrides apply only to inserted text. The requested override adds the narrow SDK option `style: { bold?: boolean; italic?: boolean }` and corresponding CLI `--style-json`. An override requires at least one key; omitted keys inherit, explicit false disables. Unknown keys fail. This is a documented extension of the initial replacement flag list required by this task; it does not introduce full font editing.

## Research accounting

Read `docs/pptx/upstream-test-audit.md`, `upstream-test-inventory.json`, `upstream-api-audit.md`, `upstream-api-inventory.json`, `api-language-mappings.md` and the shared specifications. The pinned source is python-pptx commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`; existing MIT research notice remains at `docs/pptx/upstream-license-notice.txt`. No source implementation, assets or wording is copied into product cases.

`docs/pptx/text-replacement-accounting.json` records every selected unit parameter variant, expanded BDD text scenario, and text property including inherited placeholder properties. Literal preserving replacement has no equivalent source operation. Destructive `.text` setters and `clear()` remain separate public obligations under J10 and must not be marked covered by preserving replacement. Hyperlink setters remain separate from preservation of existing links. Original replacement regressions supplement the baseline rather than inflating its parity count.

Documentation drift resolved for this slice: historical audits describe their original planning baseline, not the current package; their blanket “not implemented” prose cannot establish current replacement status. Conversely, current replacement does not implement the complete live model. Underscore-prefixed public Run/Paragraph/Cell/Hyperlink types and inherited properties remain explicit obligations. Usage and accounting here describe the bounded operation only. Shared flags require explicit first/all/occurrence even though initial feature prose names only first/all.

## Validation and QA procedure

1. Run the narrow maintained package unit/type/lint routes, including original memfs SDK/CLI cases and independent XML/ZIP assertions. Record red and green evidence without counting corpus runs as unit tests.
2. Authenticate `.cache/pptx-corpus/IXPE-Presentation-Template.pptx` against `docs/pptx/corpus-manifest.json`: 1,202,514 bytes, SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`. Read only this disposable local cache input; do not download or stage it.
3. Admit authenticated bytes through the explicit SDK or VFS capability. Select an existing literal on a slide and replace it in a disposable output. Independently reopen output, verify affected text and preserved relationships/unrelated parts. Check first versus all and a no-match allow-empty run. Keep outputs ignored or outside repository tracking.
4. If findings arise, reduce them to small original XML/package regressions using memfs, then rerun the focused checks. Do not make unit tests depend on fixture files or network access.
5. Capture and inspect the exposed CLI help/output screenshot with the maintained screenshot route where available. This validates CLI presentation only; no renderer fidelity claim.
6. Record actual check and QA outcomes below before the local atomic commit. Do not execute the entire pipeline.

## Evidence

- Corpus input hash and byte size authenticated by the coordinator against the manifest.
- SDK corpus QA passed with `find: "presentation"`, `with: "QA Ω"`: first replaced one occurrence and changed only slide 2 (37 unchanged members); all replaced four occurrences and changed only slides 2–5 (34 unchanged members). A nonexistent search with allow-empty returned the identical 38-member archive. Input SHA-256 remained unchanged; no output files were written.
- The first QA oracle compared ZIP entry order and failed because the maintained writer canonically sorts members. Corrected the oracle to compare member sets and exact untouched bytes. This was an assertion correction, not a product regression.
- Maintained package unit suite passed: 1,305 tests in 50 files (22.49 seconds). The new SDK replacement suite passed 30 cases (~647 ms) and command suite passed 23 (~359 ms). Selected workspace build closure passed for three workspaces. Safe-bash selector suite passed all 44 cases. Focused command/adapter lint and final maintained package lint passed.
- Screenshot preparation initially attempted to decode shell string output as bytes. Corrected the capture oracle to use stdout/stderr strings; no product failure or source change was needed.

- Visual CLI review passed using `npm run screenshot` for the nested safe-bash surface: before/read, two replacements, after/read and missing-mode usage output were legible, with statuses 0, 0, 0 and 2. Screenshot remains ignored at `screenshots/pptx-text-replacement.png`; no QA fixture or screenshot is staged. This exercises the nested utility rather than a root poe-code route.
- `git diff --check` passed. One coherent atomic feature commit includes the bounded internal XML helper needed by preserving replacement. Local commit only; no push/release requested.
