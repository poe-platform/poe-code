# AW documentation hard-break format repair

## Scope and provenance

Documentation-only author repair on August 29, 2026, in isolated main clone `/Users/kjopek/Workspace/poe-code-safejs-aw-doc-format`.
A fresh single-branch clone was followed by successful `git -c pull.rebase=false pull --ff-only` before work.
Base: `04370307df002810a336985a660585af4358b905`. No Git mutation followed that pull; no commits, pushes, branches, index/config changes, or runtime source edits.

The approved AW candidate manifest remains unchanged at `/Users/kjopek/Workspace/poe-code-safejs-source-exceptions-integrated/out/safejs-remediation/source-exceptions-integrated-validation/candidate/manifest.json`, SHA-256 `5a10256673e8ef553738223efd0caca1fd2325e1980da6f8d8090a9a2a22e2ae`.
The publication set is its seven AW files plus the explicitly approved eighth, `docs/plans/safejs-validate-source-exceptions-integrated.md`.
This note is a separate documentation publishable, not a ninth AW runtime change.

## Exact repair

Only `docs/plans/safejs-validate-source-exceptions.md` changes within the approved eight-file set.
At lines 108, 163, 236, 457, 666, 771, 850, 961, 1038, 1089, 1128, 1183, 1392, replace the Markdown two-space hard break with a backslash hard break.
No prose, assertion, recorded value, log, original failure history, or line numbering changes.

- Old SHA-256: `5492f3ccca999e952d8484a861e079be0f4bc3bf9a2eb2b32062a236efce4df5` (52201 bytes).
- New SHA-256: `c433c7ab76f1c8cd97474789a714c5198d6b5f5319b1cfa750696f8ce8d6a62a` (52188 bytes).
- All other seven approved publication postimages remain byte-identical, including the independent integrated report.
- The pinned Markdown parser produces identical old/new syntax trees after removing source positions; both contain exactly thirteen hard-break nodes.
- Prettier 3.8.3 preserves both spellings. The new spelling avoids trailing-whitespace errors without changing rendered breaks.

## Current prerequisite and layering

NUM-001 publication `32caeaddbac72bccea1cb3fd0a07fb293a1bee71` is an ancestor of the fresh base.
All eleven NUM prerequisite paths match the approved manifest postimages byte-for-byte.
Both current-main AW production preimages also exactly match the candidate's post-NUM preimages.
No merge conflict, runtime semantic repair, prerequisite reapplication, or whole-file overwrite of live main code is needed or performed.

The isolated snapshot contains the current NUM prerequisite and the complete eight-file AW publication.
Only snapshot copies receive the already approved AW production/test files; live main production files remain untouched.
The after snapshot additionally contains this separate repair note.

## Checks and historical failure preservation

Nash's original layered-tree whitespace result (exit 2) is retained unchanged as evidence, not reclassified or waived.
The original report passes Prettier but introduces thirteen whitespace errors in the full publication diff.

- Full original eight-file snapshot: `git diff --no-index --check` exits 3 and reports the exact thirteen report lines.
- Full repaired snapshot: the same check exits 1 with no diagnostics. No-index mode reports ordinary file differences with status 1; the whitespace-error bit is absent.
- Strict full original publication patch: `git apply --check --whitespace=error-all` exits 128 and reports thirteen whitespace errors.
- Strict full repaired publication patch: the same check exits 0, including all eight AW files; the final gate also includes this note.
- Prettier's explicit check and per-file format comparison cover all eight publication files. This note is checked separately and with the final publication set.
- The report-only patch is also checked against its exact old preimage with whitespace errors enforced.

No whitespace configuration, ignore rule, or failure waiver is used. The no-index check is supplemented by an actual zero-exit strict patch gate; it is not represented as exit 0.
No unit tests, runtime validations, dependency installation, LLM calls, guest I/O, or original-audit reads are needed or performed for this documentation-only task.
Prior runtime validation claims and limitations are preserved as historical content, not rerun or expanded here. AR-001 external-dump behavior remains outside scope.

## Immutable handoff

`out/safejs-remediation/aw-doc-format/` contains old/new report captures, a report-only unified patch, the original approved manifest and Nash failure evidence, eight-file publication postimages, current preimages, full layered patches, exact commands/results, prerequisite hashes, and a refreshed publication manifest.
All old manifests and other clones remain unchanged.
The refreshed manifest separates the eight AW publishables, this repair note, and the already published NUM prerequisite.
Capsule files are frozen read-only and immutable after final verification; its inventory records their hashes.
Artifacts under `out` are nonpublishable and are not staged or hidden through Git configuration.

Ready for Helm's independent formatter review, not a runtime approval, publication action, or overall-goal completion.
