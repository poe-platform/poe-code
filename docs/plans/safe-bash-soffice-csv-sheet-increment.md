# behavior-soffice: CSV sheet preflight increment

## Scope and source basis

Implemented `planCsvSheetExports` in the private, dependency-free TypeScript ESM
`packages/safe-bash-command-soffice` workspace. The existing composition-only
`@poe-platform/safe-bash/commands/soffice` export picks up its API and declarations.
The package pattern is currently at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its relocation was
preserved rather than undone.

LibreOffice/core revision `d17755172ac96e54e3f10f35dd1b1680f0ef84bd`
remains the source basis. CSV export selection is the twelfth token, distinct
from CSV import. The planner accepts the already parsed selector and supplied
workbook metadata. Zero uses the current sheet/base name, -1 enumerates all sheets
in workbook order, and positive one-based selections use per-sheet names.
Invalid/out-of-range selections fail instead of fabricating empty output.
This is source-derived implementation, not native conversion qualification.

## TDD and review

Added failing memory-only edge-case tests before implementation. The initial
workspace test run failed because the requested API did not exist. Tests then
covered current/explicit/all selection, invalid and out-of-range selectors,
empty workbooks, path traversal/separators/NUL/unpaired surrogates, canonical VFS
directories, Unicode/literal punctuation and identical output destinations.
Budget tests cover work, nodes, retention exhaustion before and after a target,
cancellation/closed invocation, and failed-call rollback preserving earlier
successful reservations. Integration with the existing CSV option parser checks
token position and exact retained path accounting.

Reviewed the implementation for bounded traversal and allocation: directory
validation scans without splitting/slicing, path-length work and UTF-16 storage
are charged before constructing destinations, and nodes bound target/lookup
entries. Successful path reservations last until invocation close; failed calls
release only their own retained paths. Work/node charges remain cumulative on
failure. Caller-owned sheet names and source metadata are not copied or decoded.
The planner consumes zero input, decoded-stream or output bytes and zero pages;
there is no parser recursion, file access, executable/network/font capability,
producer stream or staged resource to clean up. It performs no conversion I/O.

## Acceptance status

| Matrix cell | Implemented subcase | Status |
| --- | --- | --- |
| C02 | Typed current/all/positive selection, naming, invalid/out-of-range rejection | Unit verified; whole cell OPEN |
| C06 / A16 | Exact destination collision and unsafe-component preflight | Unit verified; whole cells OPEN |
| All other CSV cells | Import, content/encoding/BOM, formula/fixed-width behavior, messages and publication | OPEN |
| Writer/Calc/Impress conversion matrix | ODF/OOXML adapters, loss-preserving models, conversion handlers | OPEN |
| PDF/layout/shaping profiles | Supplied fonts/assets, pagination, independent standards/screenshots | OPEN |

The planner takes an already derived source stem and canonical absolute VFS
directory; it does not establish native basename/URL semantics. Traversal and
identical destinations are deliberately rejected as product safety policy.
Case folding, inode/alias checks, preexisting targets, overwrite/diagnostic order,
transactional publication and cancellation during export remain unimplemented.
No CLI handler exists, so CLI/SDK conversion parity remains OPEN. No visual CLI
behavior changed and no screenshot or native parity evidence is claimed.
No installed-artifact verification is renewed by a workspace build alone.

## Verification

- All 29 focused workspace unit tests pass, including the new edge cases.
- Workspace ESLint and production/test TypeScript checks pass.
- Fresh maintained selected command-workspace build passes (`--no-cache`).
- Maintained safe-bash workspace build closure passes.
- Manual import of the built safe-bash soffice subpath exposes the planner and
  returns the expected target; this is a workspace smoke, not an isolated
  installed-artifact qualification.
- `git diff --check` passes. No commit, push, release or publication was performed.
