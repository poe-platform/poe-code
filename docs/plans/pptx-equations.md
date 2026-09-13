# PPTX equation implementation and QA

Implement F41 OMML extraction/inventory and bounded, validated caller-authored
insertion. Preserve math and alternate fallbacks through unrelated text and slide
operations. No renderer, evaluation, implicit host I/O, native product runtime,
network, README changes, whole pipeline, push or release.

## Ownership and acceptance

Root coordinates exports, provenance, review, QA and local commits. Delegated
domain worker owns equations.ts and domain tests; CLI worker owns equation schemas,
command integration and adapter tests; preservation worker owns text regressions
and validated fixes. Shared command-engine/index/registration files contain
preexisting image work: stage only equation changes, preserving that work.

Use original fast in-memory tests, independently inspect serialized XML and
exercise SDK and configured safe-bash entry points. Assert namespaces, malformed
structures, unsupported extensions, embedded math boundaries, fallback retention,
schema/help/capabilities and admission/publication failures. Record actual checked
subsets without claiming complete model coverage. Keep audit identities in
research and legally required standalone notices only.

## Research

Consulted docs/specs/pptx.md, office-cli.md, office-sdk.md, root/scoped AGENTS.md,
docs/pptx/upstream-test-audit.md, upstream-test-inventory.json,
upstream-api-audit.md, upstream-api-inventory.json and corpus-manifest.json.
Pinned inventories contain 2700 unit variants, 973 expanded BDD examples and
2407 public API records. No literal equation/OMML records occur in these three
collections; general text and slide obligations remain applicable and must not
be relabeled as complete parity. Preservation worker records relevant mappings.

The presentation-specific math constraints are described in
[MS-ODRAWXML section 2.2.5](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/853b19c7-68a9-4f9a-a2ae-5e6cb0d02e62).
Use namespace identity, bounded XML parsing and explicit capability input.
Unsupported existing markup remains inspectable and preserved, not authored.

## Disposable QA procedure

Verify manifest SHA-256 before admitting cached
`.cache/pptx-corpus/data-visualization-course.pptx`; its census records 20 math
objects. Use explicit trusted limits for this 52,907,926-byte input. Inventory
math, compare raw OMML/fallback subtrees and package parts before/after an unrelated
text edit and selected slide copy. Do not ship or commit corpus bytes/outputs.
Reduce meaningful findings to original unit regressions. Record missing native
viewer or visual evidence separately; structural checks do not prove rendering.

Inspect a screenshot of current equation command help/error output using the
maintained screenshot route where compatible or the existing terminal capture
utility. Screenshots are disposable manual evidence, never unit tests.

## Maintained checks and delivery

Run focused TDD tests, pptx workspace unit/lint checks, the selected pptx build
closure and affected safe-bash checks. No full pipeline. Each atomic improvement
receives its own Conventional Commit on main after checks; explicit owned paths
only. Report local hashes separately; nothing is pushed or released.

## Execution receipts

Verified the corpus input's 52,907,926 bytes against SHA-256
`ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2`.
Raw XML independently contained 20 equations. The first SDK inventory returned
zero because effective text reading selected image fallbacks. Reduced that
finding to the original shape-level alternate-content memfs regression in
equations.test.ts; the repaired SDK returns 20 across slides 25, 34 and 35.
All 20 are honestly marked outside the bounded authored subset.

An explicit first literal replacement on slide 25 changed one text match and
only `/ppt/slides/slide25.xml`. Independently compared every extracted OMML string
before/after (20 equal) and the edited slide's raw fallback markup (one equal).
The admitted input hash remained unchanged. No binary output was saved or staged.
This QA used byte/archive ceilings 120 MB, entry ceiling 55 MB, total expansion
140 MB, 1000 parts, XML 32 MiB/100000 nodes/depth 256 and 10000 relationships.
These are trusted QA limits, not changed product defaults.

Duplicating corpus slide 25 was rejected with `unsupported-edit` by the existing
slide-copy structure/dependency remapping boundary. This is not a corpus copy
success or rendering claim. Original bounded OMML slide duplicate/import fixtures
exercise successful preservation separately. No independent slide renderer was
run; visual equation fidelity remains unverified.

Ran the maintained generic screenshot route (`npm run screenshot`) against actual
equation command help and missing-selector error output. The poe-code-specific
route would invoke unrelated root setup rather than the injected command engine.
Inspected `/tmp/pptx-equations-cli.png`: legible help, supported subset, selector
limitations and typed error; no clipping. The image is disposable, not staged.

Final frozen checks: pptx unit route passed 135 files / 3733 tests; pptx lint
passed ESLint plus source/test TypeScript; maintained selected build passed its
three declared workspace builds. The earlier live-edit run observed four new
dialect tests before their implementation was loaded; it was not reported as
passing. The final frozen run includes both matching dialect round trips and
both mismatched target rejections.

Rebuilt public-package safe-bash equation checks passed 2/2; exact integration
inventory check passed 1/1. Focused guarded lint authenticated all 25 receipts
and passed both owned adapter/registration subjects with no diagnostics. Full
safe-bash typecheck and the whole pipeline were not run. See the CLI plan for
exact routes and scope. Local preservation commit: `1d5141db9`.
