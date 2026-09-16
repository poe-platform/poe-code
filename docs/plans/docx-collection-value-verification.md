# DOCX collection/value verification

Scope: verify the existing public-surface task on main; no implementation replay,
push, release, README edits or unrelated staging. Root owns this plan,
`docs/docx/collection-value-verification.md`, and the enum-availability correction
in `docs/docx/whole-api-acceptance.md`. No delegation or product changes.

## Agent QA procedure

1. Inspect root/scoped instructions, relevant DOCX and shared CLI/SDK requirements,
   retained API/test inventories, current exports and original acceptance tests.
2. Compare enum values and aliases with the retained inventory, applying the
   documented XML sentinel mapping. Inspect recorded red/green evidence and
   retained human CLI screenshots. Do not count missing logs or QA as passes.
3. Run maintained DOCX tests, lint and selected workspace build closure. Report
   unavailable schema prerequisites without acquiring native or network inputs.
4. Reproduce any new product defect with an original failing memfs test before
   changing code. Correct verified documentary drift separately.
5. Stage only the three owned documentary files and commit the atomic correction
   with Conventional Commits. Preserve unrelated files and index entries.

## Outcome

The maintained suite, lint and scoped build passed. Existing original enum and
collection cases passed; no new product defect was reproduced. The current
whole-API summary incorrectly reported direct enum protocols as absent. Corrected
that statement and linked the bounded evidence without promoting missing owners
or rewriting historical JSON observations. Detailed checks and gaps are in
`docs/docx/collection-value-verification.md`. Local delivery only.
