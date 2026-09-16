# Retire disposable DOCX QA fixtures

Task: `retire-disposable-qa-fixtures` only. No product code, README, push or release.
Owned paths: this plan, `docs/docx/corpus-retirement.json`,
`docs/docx/corpus-manifest.json`, and only this task's status hunk in the pipeline.
Existing dirty pipeline/specification/source changes are outside this ownership.

## Procedure and gates

1. Read root AGENTS.md, docs/specs/docx.md, office-cli.md and office-sdk.md;
   review upstream-api-audit.md and upstream-api-inventory.json. Inventory counts
   describe historical research, not implementation or a conformance certificate.
2. Audit completed structure, image, independent-schema and visual campaigns.
   Link each meaningful invariant to existing original deterministic tests or an
   explicit unresolved disposition in the retirement receipt. Never copy source
   passages, images, branding or binaries into regressions. No new validated
   defect requires a product fix here; any future fix needs an original failing
   assertion first. Existing characterization passes are not historical red runs.
3. Rehash every present regular nonsymlink manifest-listed input. Temporarily
   rename each individually with `.retirement-hold` in its existing parent;
   leave every original input path absent during maintained canonical unit tests.
   Do not move/delete parent directories or unrelated files. Restore held files
   if checks fail; otherwise remove only those exact verified held files.
4. Run maintained selected workspace build closure, DOCX unit and lint routes.
   Record results and log hashes. Scan product/tests for corpus dependencies and
   reference identities. Schema-native and rendering campaigns are separate
   from canonical units; do not claim their rerun from a unit pass.
5. Verify the two existing campaign output manifests: 48 structure files and
   692 image files. They were already deleted; count them as verified absent,
   never as new deletions. Leave unlisted research/cache files and all unrelated
   `output/` directories untouched. Visual follow-up artifacts in `/tmp` remain
   outside the owned cleanup set and retain their explicit campaign disposition.
6. Keep source URLs/checksums, licensing evidence, census, concise campaign
   outcomes, unresolved findings and original tests. Update manifest retention
   wording to distinguish historical acquisition from current absence.
7. Format/check owned docs; stage explicit owned files and only the pipeline
   status hunk. Commit one atomic retirement improvement on main using the
   Conventional Commit skill. Never bypass hooks, add co-authors or commit cache
   files. Report the local hash; no remote delivery or release.

## Shared contracts and exact mappings

This cleanup changes no public command/SDK behavior. Utility routes remain plural
`images`, `tables`, `properties` and `text.replace`; operation options are
camelCase, model methods/properties retain neutral documented snake_case.
Byte admission/save and utility operations are awaited Promises using owned
Uint8Array and explicit bounded I/O, cancellation, time/identity/font capabilities.
Live getters/setters remain synchronous where documented. Model sequence lookup,
`.at`, `.slice`, `.length` and iteration are zero-based; keyed lookup stays keyed,
CLI ordinals are one-based and authenticated locations reject stale selection.
Null, undefined, false and zero are distinct; lengths round nearest with halfway
away from zero into safe integer EMUs, dates use documented UTC precision.
Enums/aliases, helpers, inherited members, returned owners and publicly documented
underscore-prefixed types remain in scope, including APIs without upstream tests.
Safe XML/package views grant no ambient host/network/eval authority. Ordinary
CLI exits remain 0/1/2/3/4/130, with diff's separate documented comparison mapping;
version-1 JSON and discovery/capabilities stay conservative.

Existing D01–D23 documentation resolutions and exact mappings remain linked in
upstream-api-reconciliation.md and public-api-map.json. Cleanup does not invent
aliases or promote pending APIs. The manifest's acquisition-time “retained because
QA has not run” statements are historical drift resolved by the dated retirement
record, not evidence that all proposed format behavior is implemented.

## Results

Completed locally on main. Maintained selected workspace build closure passed;
canonical DOCX units passed 178 files, 3438 tests, with four skipped in 131.46 s
while all 23 original downloaded paths were absent. Package lint/source/test types
passed with one existing warning. No product code or new tests were needed.

Deleted 19 individually hash-verified remaining source files; four were already
absent from the image campaign. Verified all 740 previously listed structure/image
output files remain absent, with zero new output deletions. Deleted no directories;
all 36 unlisted cache files were rehashed and preserved. Other worktree/output and
explicit visual follow-up artifacts remain untouched. The receipt retains source
identities, check hashes, original test links and explicit unresolved dispositions.
No whole-format, model, native-schema or rendering completeness claim is made.

Final formatting, whitespace and owned staging checks precede the atomic local
commit. Its hash is reported in chat; no push or release.
