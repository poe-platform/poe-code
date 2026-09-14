# Bounded package semantic validation

Owned task: `package-semantic-validation`. Later tasks remain pending. Work is
on main; local commit only, no push or release. The concurrently modified master
pipeline and archived-plan changes are unrelated and remain untouched.

## Scope and evidence

Read root AGENTS.md, DOCX and shared Office CLI/SDK contracts, the API audit,
reconciliation and parsed API/test inventories. There are no scoped AGENTS.md
files under packages/docx. The case crosswalk assigns zero source cases to this
particular task; new cases are original semantic obligations, not untracked
copies of external tests. No public model coverage is claimed.

Implementation is in packages/docx. The existing package, dialect and XML checks
are reused and gain located errors. A bounded semantic pass checks roots,
relationships, references, IDs, fields and grids. Staged package snapshots and
the document publication entry point validate before document bytes escape.
The low-level ZIP codec remains available for raw/malformed fixture construction.
The current pipeline has no docx CLI adapter; command/schema/capabilities and
model APIs remain owned by later tasks. No root wiring or safe-bash changes.

The [published profile](../docx/validation-profile.md) records exact checks,
limits, diagnostic paths, JS/security mappings and exclusions. Namespace-list
and audit wording drift is corrected without erasing historical evidence.

## Failing tests before implementation

- Initial corrected fixture run: 17 failures, including missing validation API
  and an invalid staged bookmark edit escaping snapshot; independent ZIP write
  baseline passed. An earlier fixture setup error was corrected before counting
  this red evidence.
- Expansion: six failures for style cycles, numbering levels/required abstract
  references, related-part diagnostics, and unsigned drawing IDs.
- Publication/profile expansion: four failures for shared error code, missing
  document writer and core math MCE understanding. A test helper export typo was
  corrected; it was not a product defect.
- Further regressions: required metadata, numbering-style cycle and relationship
  usage checks failed before implementation; dangling target location likewise.
- Final review regressions failed for case-insensitive metadata/MIME handling
  and ten revision range/property ID variants before their fixes. A glossary
  scope regression likewise failed before restricting semantic reference checks
  to the supported main-document closure.
- Resource boundaries, field story isolation, vertical merges and inactive MCE
  cases passed without speculative code changes. Four original fixture themes
  pass; these are not downloaded qualification inputs.

## Verification

Completed locally:

- `npm run test --workspace=docx`: 368 tests across 11 files pass, including
  52 new validation cases and all 316 original tests.
- `npm run lint --workspace=docx`: ESLint, source type checking and test type
  checking pass.
- `npm run build:workspaces -- --workspace=docx`: maintained selected workspace
  closure passes (docx, office-package, safe-fs).
- `git diff --check`: passes.

Independent assertions use separate ZIP/CRC/decompression and Saxes code on
staged output in memfs.
No CLI surface changes or CLI screenshot claim. No renderer, full XSD conformance,
large downloaded-input qualification, remote delivery or release is claimed.
