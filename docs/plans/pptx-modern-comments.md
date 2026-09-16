# Modern comment inventory and preservation

## Scope and ownership

Implement F50 inventory of modern comments, identities, replies, mentions and
reactions where pinned schemas establish their meaning. Preserve unknown XML and
part relationships without fabricating identity equivalence. Modern editing and
cross-document identity remapping remain unsupported and must fail before output.
Legacy annotations coexist without conversion. This is a bounded implementation
receipt, not completion of the entire PPTX specification or public API.

Root coordinates integration, research accounting, checks and local commits.
Workers own inventory/schema, mutation/import safety, and safe-bash regressions
respectively. Existing image/media work and other unowned changes remain intact.
No README, root API, native product runtime or product network changes are planned.
No push, release or whole pipeline execution is authorized.

## Test-first implementation

1. Reproduce omitted modern records and unsafe identity remapping using small
   original XML packages held in memory; use memfs for filesystem-facing tests.
2. Implement namespace-aware inventory and explicit unsupported mutations.
3. Independently assert comment/author/reply associations, opaque XML and bytes,
   modern/legacy coexistence, selection identity and security interactions.
4. Exercise the same domain operations through the safe-bash SDK/CLI adapter,
   schema/capabilities and stable result/error envelopes.
5. Run maintained pptx unit/lint/build routes and focused safe-bash command checks.
   Do not run the whole workspace pipeline.
6. Review owned diffs, stage explicit owned files and commit atomic improvements
   on main with Conventional Commits. Report local hashes separately from delivery.

## QA procedure

Use only disposable inputs enumerated in `docs/pptx/corpus-manifest.json`; verify
recorded byte hashes before inspection. Do not download fixtures for unit tests or
commit corpus assets. Inventory cached corpus documents for modern comment and
identity namespaces. An empty corpus result is a coverage limitation, not proof
of modern-format fidelity. Reduce meaningful findings into original small tests.

Capture and visually inspect comment CLI help/output using the terminal renderer
with an explicit command. The default screenshot-poe-code preparation invokes the
whole workspace predev pipeline, so use the explicit-command screenshot route for
this task. Keep the image in disposable cache; add no screenshot tests.

## Research obligations

Review all 2,700 parametrized unit rows, 973 expanded BDD rows and 2,407 API records
for direct comment/thread/identity coverage. Preserve source IDs only in research.
Keep metadata `comments`/`author` and shape enum obligations distinct from slide
annotations. Retain existing lifecycle dependency accounting and all unsupported
public API records, including inherited and underscore-prefixed types. Record
exact schema sources, JS/security mappings and evidence in `docs/pptx`.

## Verification receipt

Implemented. Maintained pptx unit route passed 4,173 cases in 163 files; package
lint and selected three-workspace dependency-closure build passed. SDK/CLI comments
suites passed 8/8; maintained safe-bash runner checks passed 499/499. Screenshot
was inspected. Detailed scope, corpus evidence and mappings are recorded in
`docs/pptx/modern-comments-evidence.md`.

The authenticated census found four author-only modern tables. A second read-only
QA pass invoked the freshly built public `readCommentAuthors` with explicit
expanded limits and verified modern counts 3, 2, 2 and 15; the last package also
contains 11 legacy authors. The original author-only memfs regression covers the
missing-inventory finding without copied corpus data.

The optional broader guarded root ESLint run reached its 12,000-subject cap and
exited 2 with zero reported findings. Record it as incomplete, not passed; preserve
the guard and unowned infrastructure. Final package checks are rerun after the
three additional container/sibling identity regressions and full-list validation.
