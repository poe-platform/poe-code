# Public surface review and agent QA

Date: 2026-09-13.

Ownership: the review delegate owns this plan and
`docs/pptx/public-surface-current-gaps.md` only. Implementation files, shared audit
registers, README files, unrelated work and commits belong to their assigned owners.

Completed review: read root instructions, shared SDK/CLI and format contracts,
API/test audit records and inventory structure, then inspect exports and existing
live model boundaries. Findings are recorded in the linked evidence document;
the review does not claim complete API or runtime validation.

Agent QA for an owner integration:

1. Add original small failing public-export tests before changing domain code.
2. Create/admit a presentation from bytes and explicit memfs VFS input; verify
   every factory/admitting/save branch returns a Promise, including rejection.
3. Mutate existing Shape/TextFrame/Paragraph/Run/Font/Table children synchronously,
   including a previously obtained child handle, then save and reopen to verify
   persistence through the same domain implementation.
4. Exercise byte ownership by mutating caller input and returned serialized bytes;
   neither may alter live model state after admission or serialization.
5. Exercise foreign owner assignment, stale replacement handles, sparse placeholder
   IDs and collection-specific bounds before claiming live graph coverage.
6. Use explicit cancellation and publication capabilities to verify admission
   failure, abort before publication, stale destination and write failure leave
   preexisting destinations unchanged under the supported transaction contract.
7. Verify admitted font metrics and supplied author/time defaults without ambient
   discovery; omitted timestamp stays omitted and no author is inferred.
8. Run maintained package tests/lint, inspect generated command schema and run
   required ad hoc CLI screenshots only if command presentation changes.
9. Record exact tests/checks and remaining surface gaps in `docs/pptx`. Stage only
   assigned changes and relevant plans for an atomic Conventional Commit on main.
   Report local hashes; do not push or release for this task.

No executable QA script, downloaded fixture, native runtime, network operation or
ambient host authority is part of these acceptance cases.
