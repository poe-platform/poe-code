# Corpus task API-status reconciliation

Task: `fill-corpus-feature-gaps` only. Status: documentary correction complete.

## Scope and ownership

Own this record and `docs/docx/upstream-api-audit.md`. The acquisition task asks
for the API audit/inventory and resolution of documentation drift. This correction
reconciles current research status without implementing another pipeline task.
Keep all later tasks pending, preserve unrelated edits, change no README or
product files, and do not push or release.

## Failure evidence and correction

Before editing, the audit asserted that all 2,259 source cases remained unmapped
and the next task still owned concrete signatures/routes. Parsed maintained
evidence contradicts that current-state wording: `test-case-map.json` has 2,259
rows, while `public-api-map.json` has 1,337 rows and explicitly zero implemented
or passing behaviors. `upstream-api-inventory.json` retains 920 unique source IDs.
The documentary mismatch was established before editing; no product code or
product failing-test claim is involved.

Correct the audit's status, signature-map reference and final validation paragraph.
Retain historical review records and source baselines. Link current maps and
clearly separate proposed acceptance contracts from executed tests. Existing
comment_id/timestamp decisions and all exact JS language/security mappings stay
unchanged. Inherited and underscore-prefixed documented public members remain
in scope, including untested APIs.

## Agent checks and local delivery

1. Parse inventory and maps and compare current counts with the audit wording.
2. Verify the corrected links resolve, stale current-state claims are absent,
   and the maps still declare zero implementation/passing behavior. Preserve
   the original inventories and maps byte-for-byte.
3. Run `npm exec --no -- prettier --check` on the two owned Markdown files and
   `git diff --check`; inspect the explicit owned index.
4. Commit only these paths on main with a Conventional Commit, no co-author or
   hook bypass. Report the local hash, with no push or release.

The correction is a separate atomic documentary improvement from the corpus
acquisition commit. No unit/build/render/screenshot pass is claimed or required
for this prose-only status correction.

Results: parsed counts, zero-implementation assertions, local link checks,
maintained formatting and whitespace checks passed. Inventories/maps were not
edited. The final response supplies the local commit hash.
