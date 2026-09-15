# Bounded safe DOCX extraction

Scope: execute only `safe-docx-extraction` from the existing document pipeline.
Packing and all subsequent tasks stay pending. Existing changes in the parent
pipeline and equation records are outside this task's ownership.

## Implementation and evidence

- Add original failing byte/VFS and command regressions before implementation.
  Initial execution failed on the absent SDK export and rejected CLI options.
- Implement `extractDocumentArchive` and the existing `extract` command through
  the same package engine. Keep root wiring and safe-bash adapters unchanged.
- Admit the complete archive and validate file/directory namespaces before
  selection or VFS mutation. Reject traversal, duplicate/link members, reserved
  manifest paths, file/directory conflicts and ambiguous decoded/NFC/casing aliases.
- Preserve exact payload bytes by default; support all/media-only selection,
  empty directories and explicit XML display formatting.
- Require explicit partial-output consent and a new tree beneath an existing
  canonical writable parent. Conditional directory creation and file publication
  use actual VFS parent identities and absent-entry expectations. No recursive
  cleanup or guessed rollback exists.
- Reserve manifests and failure receipts before creating output. Preserve precise
  confirmed publication flags and possible-partial-output state on I/O, cancellation
  or final response failure. A rejected VFS call can have created new bytes without
  a confirmed published flag.
- Later failing regressions exposed empty-directory omission, absent receipt
  admission, lost final-stdout receipts, conflict-status drift and excluded
  non-ASCII casing aliases; each was corrected after its failing run.
- Preserve and update the exact original discovery assertions additively. The first
  package run had 3 discovery failures and 3,096 passes; no tests were removed or
  renamed, and this historical failed run is not claimed as final verification.

## JS/security and API scope

See [the behavior and language mapping](../docx/archive-extraction.md). Read the
shared CLI/SDK contracts and the existing public API audit/inventory. This is an
additive F50 utility; it does not complete or exclude any Document, Package,
Part/XmlPart, inherited member, enum, collection, helper, prose-only API or
public underscore-prefixed owner. Retain neutral documented model spellings.
No reference runtime, downloaded fixture, network request, native document tool
or external derived implementation is used. Historical inventory dispositions
and standalone notices remain unchanged.

## Maintained verification

Verified on main:

- `npm run build:workspaces -- --workspace=docx`: passes the five maintained
  dependency/build stages, including portable VFS build and design export smoke.
- `npm run lint --workspace=docx`: passes ESLint and both product/test TypeScript
  checks. The untouched operation-types test retains one unused-variable warning;
  there are no lint errors.
- `npm test --workspace=docx`: 153 files and 3,103 tests pass, uncached.
- Final focused extraction/discovery run: 49 tests pass, including the final
  test-only duplicate case entirely outside the media selection. There are 29
  extraction regressions; the full run had already admitted its 28-case version.
- Built `docx` public exports verified through the package import.
- Final help PNG inspected; short lines and all required options are readable.
- `git diff --check`: passes.

The second already-running package campaign loaded the pre-fix Unicode alias
implementation: its two reduced alias cases failed while 3,101 tests passed.
The fresh final package campaign above verifies the corrected code. Preserve
these failed-first records; none is counted as successful verification.

Only safe-docx-extraction is marked implemented/tested in the parent pipeline.
Stage that owned status hunk independently of its preexisting task-state edits.
Stage only owned source, tests, contracts/evidence and this plan; commit the one
extraction improvement on main. Do not push or release. Packing and later
implementation/test states remain pending.

## Manual visual QA

1. Use the maintained terminal screenshot runner to render the built command
   engine's `help extract` output. This utility is an explicit opt-in shell command,
   not a root poe-code subcommand; invoke its public command engine directly.
2. Inspect the PNG for readable options and accurate destination, consent,
   selection, XML formatting, collision and partial-output instructions.
3. The initial screenshot exposed an overlong description. Split detailed help
   into short lines and repeat screenshot inspection.
4. Keep images only in `output/docx-archive-extraction-qa`; do not stage QA fixtures.
