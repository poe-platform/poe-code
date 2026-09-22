# engine-soffice task review

Reviewed the current private soffice workspace on 2026-09-20. Preserved unrelated
working-tree edits. The package is TypeScript ESM, private, and has no dependencies.
Its source imports only local modules and contains no host execution, filesystem,
network, native/WASM fallback or dynamic dependency loading. Safe Bash exposes a
composition-only export. Existing artifact evidence is recorded separately in
`safe-bash-soffice-engine-contract.md`; this review does not renew that artifact
qualification or establish remote delivery.

Two issues were reproduced with original failing tests and fixed:

- Empty argument lists bypassed cancellation and closed invocation checks. Parser
  entry now checks the supplied budget, including when there are no arguments.
- Filter resolution charged extension counts but not extension text. It now
  charges lookup-key and declared extension lengths before string comparisons,
  so a large registry entry cannot bypass the work limit.

All 19 focused workspace unit tests pass. The regression tests use pure memory
objects, create no files, and invoke no external capabilities. No proxy wrappers,
new dependencies, host access or format-engine duplication were introduced.
The changes do not alter CLI presentation.
Workspace lint, production/test typechecks, the maintained selected workspace
build, and `git diff --check` also pass.

## Unresolved findings blocking completion

The conversion suite requested by the task is not implemented. Every conversion
capability remains false. The exported semantic model and VFS/engine interfaces
are contracts, not loss-preserving adapters or enforced conversion lifecycles.
There is no executable soffice handler, so CLI/SDK conversion parity cannot be
qualified. No conversion failure, staging cleanup or cancellation during rendering
can be qualified without an admitted engine implementation.

Existing whole Pandoc, Office ZIP/XML and PDF engines have external runtime
dependencies, as documented in the engine-contract evidence. An audited reusable
first-party primitive closure remains necessary; silently bundling dependency
source would violate the task. ODF support, spreadsheet/presentation models,
deterministic PDF settings and typed JSON admission, formula evaluation, fonts,
shaping and bounded convergent layout remain open. The current model cannot
establish complete preservation of Office semantics.

Original geometry/screenshot acceptance, pagination/table/footnote retry branches,
standards validation for PDF/A and PDF/UA, and native conversion controls remain
unqualified. Source inspection and generated files cannot discharge these gates.
No commit, push, release or private-package publication was performed by this
review. These unresolved findings block task completion.
