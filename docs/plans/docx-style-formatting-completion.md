# DOCX style and formatting completion

Status: implementation and verification complete; local commit only, later tasks
remain pending.

Root owns style domain, latent-style SDK/CLI handlers, original style regressions,
and this plan. Font/tab worker owns property serializers and original tests;
schema worker owns shared operation declarations/discovery; audit worker owns
research case mappings. No README edits, downloaded fixtures, native product
runtime, implicit networking or ambient product I/O. Existing unrelated changes
are excluded from staging.

Use failing original memfs tests before each code change. Apply the root and
scoped instructions and DOCX/shared office contracts. Preserve pending model/API
rows honestly until implemented and verified; no underscore-name exclusions.

## Agent QA procedure

1. Run original focused regressions red before implementation and retain logs in
   temporary QA storage, recording precise results in docs/docx.
2. Run maintained DOCX test/lint and selected workspace build closure.
3. Exercise actual SDK-backed command paths with explicit in-memory filesystem,
   read back published bytes, and check usage/missing-selection atomic failures.
4. Capture help/results/errors with the maintained screenshot renderer and inspect.
5. Reconcile exact relevant API/source-case mappings, inspect owned diffs, stage
   only explicit owned files and relevant plans, and commit on main. Never push.

## Completed scope and original regression evidence

Implemented inherited character, paragraph and table-style formatting, latent
defaults and entries, visibility/priority/locking, base/next relationships,
Title at heading level zero, built-in aliases, name lookup and nullable values.
Live style Font/ParagraphFormat/TabStops objects use the same format-package
serializers as the operation SDK. CLI routes and typed model batches call that
SDK with explicit storage and publication capabilities.

Original failing tests preceded changes to utility flags/tab editing, style and
latent behavior, live formatting models, schema/command admission, batch handles,
publication atomicity, malformed metadata and universal measurement handling.
The delegated plans retain intermediate red/green receipts. Independent review
also reproduced unresolved applied-style fallback, imported namespace retention,
deleted-handle identity and exact enum alias/helper boundaries before corrections.

The bounded style model is available through openDocumentStyleModel. General
Document/Paragraph/Run/Table owner bindings remain later work; their source cases
are linked to original domain tests without claiming those owner bindings are
implemented. Exact language/security mappings and all 613 selected API rows and
898 selected source cases are recorded in docs/docx/style-formatting-case-map.json
and its companion audit. No unrestricted XML mutation or implicit host access is
introduced.

## Final verification receipt

- npm test --workspace=docx: 1,388 tests in 52 suites passed; no skips, 38.48s.
- npm run lint --workspace=docx: ESLint and both TypeScript checks passed.
- npm run build:workspaces -- --workspace=docx: all five selected build tasks passed.
- Safe-bash maintained DOCX registration route: 10 tests passed.
- Public portable export checks: two tests passed.
- Specification checker and git diff --check passed.

Executed actual SDK-backed Shell commands using explicit MemoryFileSystem:
create, style add/get, latent defaults/set/add/get, heading level zero, typed
tab insertion, help, missing-selection exit 1 and invalid-priority exit 2.
Read published bytes back through the SDK and verified the 72pt tab and latent
values. Missing-selection publication left no output file. The batch performed
one in-place publication.

Inspected maintained-renderer screenshots of the workflow and help. Human
multiline latent output, compact style properties, option descriptions and error
statuses are readable. Disposable QA evidence is in
/tmp/docx-style-qa-final.txt, /tmp/docx-style-workflow.png and
/tmp/docx-style-help.png; these artifacts are not committed. No publisher files
or native document runtimes were needed.

The serializers, live model, schema, SDK-backed commands and original tests form
one interdependent feature improvement and are committed together with these
plans and the audit reconciliation. Only explicit owned files are staged.
Unrelated work is preserved. No push or release is authorized for this task.

## Independent bounded verification

The follow-up review reproduced absent-ID lookup selecting a nondefault style
with a cleared ID. Two original memfs cases failed before the domain correction.
The verification procedure is to run the maintained DOCX unit/lint routes and
selected build closure, inspect retained output and audit mappings, then stage
only the correction, its regressions and this evidence update. Results and
remaining QA limits are in `docs/docx/style-formatting-verification.md`.
