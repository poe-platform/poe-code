# Document settings workflow qualification

Task: `adapt-upstream-tables-bdd` only. Root owns the new Settings model and
original settings-model tests, its Document getter/public export/closed batch
registrations and handle encoding, this plan and
`docs/docx/settings-model-evidence-20260915/`. No unrelated changes, README,
later task, push or release.

## Test first and behavior

Six original memfs/SDK tests failed before implementation: absent settings owner,
all four present/absent true/false assignment variants and absent batch actions.
A later handle assertion failed because batch serialization cloned the owner
instead of emitting the documented Settings handle; register Settings with the
existing handle encoder. A separate protected-document read failed before fixing
the constructor to request mutation authority only when creating a missing part.
All seven tests now pass. Retained red/handle-red/protected-read-red logs distinguish
these phases from the final green run.

The model is a synchronous live owner, with `.element`, `.part`, `.equals(other)`
and boolean `odd_and_even_pages_header_footer`. An existing getter is noncreating;
a missing document getter authors one internal settings part and relationship
transactionally. External/duplicate settings relationships and wrong roots reject.
True adds evenAndOddHeaders; false removes the override. Unknown unrelated settings
remain unchanged. Invalid types and protected writes reject before mutation.
Save/reopen uses explicit memfs bytes/sinks. No clock, identity, network, host
filesystem or field evaluation is discovered. Public Settings export and typed
batch schemas retain neutral source spellings; operation value remains boolean.

The BDD source contains eight settings scenarios across getter creation, boolean
reads and assignments; original tests combine exact variants only when their
input and observation are equivalent. Row-level mapping remains separate research.
The broader API inventory still includes inherited package/XML support; no type
is excluded because its spelling begins with an underscore.

## Agent QA procedure

1. Inspect the retained distinct failing runs before each respective correction.
2. Check missing-part creation, one cached owner, all boolean states, immutable
   unrelated settings, exact handle JSON, and protected read/write behavior.
3. Save/reopen through memfs and verify the public property persists and body text
   remains unchanged.
4. Run maintained package lint/unit/build and command tests; review the constructor
   for capability-safe creation and no mutation authority on existing reads.
5. Stage only owned paths and commit locally on main after passing gates.

No layout behavior is inferred. Renderer QA is explicitly not run under the
blockers recorded in docx-document-workflow-boundaries.md.
