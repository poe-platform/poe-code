# Protected-region admission improvement

Owned atomic improvement within `settings-and-protection`; later tasks stay
pending. Original failing regressions established that scoped literal replacement
rejected unrelated locked controls, and baseline admission allowed removing a
locked owner. A further failing original case established baseline protection
removal. These regressions preceded product changes and use original in-memory
document data with memfs-backed fixture/output mutations.

The shared publication guard now verifies every source locked owner remains
byte-identical at its original path, even when the candidate contains no lock.
Source document/write protection remains fail-closed when removed from a candidate.
The original current-owner namespace/inherited XML/MCE checks remain intact.
Literal replacement supplies its original baseline for initial/final admission,
and selected locked ancestors/content refuse even on a no-op. Ordinary text around
an unchanged locked control can change without altering the control.

No unlocking, password/rights bypass, protected exceptions-range editing or
host I/O is introduced. Package `unsupported-edit` stays separate from host
publication permission/I/O categories. Other content editors retain conservative
refusal. Original tests/names and unrelated changes are preserved.

The settings inventory improvement follows in a separate owned commit with
the bounded task record and exact JS/security API mappings. This improvement
does not implement a live Settings owner, inherited package/XML APIs,
collections/helpers/enums or hide public underscore-prefixed interfaces.

Local delivery only: no push or release is authorized.

Maintained final working-tree verification: `npm test --workspace=docx` passed
140 files / 2,917 tests; `npm run lint --workspace=docx` passed source/test
TypeScript and ESLint with one unchanged original type-only-unused warning;
`npm run build:workspaces -- --workspace=docx` passed its declared build closure.
Original human settings/help and protected-edit exit 1 were screenshot-inspected.
`git diff --check` passed. These checks cover this bounded task, not whole API
conformance or a release. Implementation/test status: complete in this scope.
