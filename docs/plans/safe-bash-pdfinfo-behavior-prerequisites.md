# behavior-pdfinfo prerequisite revalidation

Inspected the working tree on 2026-09-21 for `behavior-pdfinfo`. Implementation remains incomplete; no acceptance cell is closed by this inspection.

## Concrete evidence

- Filesystem checks find no `packages/pdf-parser`, `packages/safe-bash-pdf-parser` or `packages/safe-bash-command-pdfinfo`.
- Source inventory finds no shared PDF inspection parser. The existing wkhtmltopdf parser is not an accepted PDF page-tree/metadata/security implementation.
- Searches of the root manifest, safe-bash manifest and `scripts/bundle-safe-bash.mjs` find no pdfinfo or pdf-parser integration.
- [Page-tree gates](safe-bash-pdf-parser.md:89), [security gates](safe-bash-pdf-parser.md:113) and [parser API gates](safe-bash-pdf-parser.md:231) remain open for implementation, refactoring and testing.
- [Engine status](safe-bash-pdfinfo.md:41) says done for implementation, refactoring and testing, despite the absent implementation. Those pre-existing edits were preserved; they cannot establish prerequisite acceptance.
- The requested package-pattern path has been deleted in the existing working tree. Its [archived copy](archive/safe-bash-command-package-pattern.md) was read without restoring the deletion; it prohibits empty command scaffolds and requires shared engine ownership.
- `packages/pdf/package.json` declares `pdf-lib`, `@pdf-lib/fontkit` and `pako`. That rendering package does not satisfy this task's zero-external-runtime-dependency parser requirement.

The [execution rule](safe-bash-pdfinfo.md:153) states: “prerequisite plans must pass their stated acceptance gates before dependent integration.” The requested behavior also explicitly requires parser metadata/security/page-tree gates. There is no accepted contract against which to write meaningful failing page-geometry, password, metadata or accounting tests. A missing-module failure would only demonstrate the already-observed absence.

## Required next increment

Implement and qualify the shared parser's byte-preserving object/stream views, inherited page boxes/rotation, security authorization and invocation-wide budgets/cancellation/cleanup first. Then implement behavior increments with original failing memory-VFS tests against those APIs. Keep input length separate from CLI-compatible stdin file size, preserve complete raw metadata separately from CLI NUL truncation, and reject unsupported flags before capability calls or output. Qualify exact bytes/status against independent native receipts per [acceptance cell](safe-bash-pdfinfo-acceptance.md); supplied fragments do not replace missing full receipts.

No command scaffold, duplicate parser, speculative runtime changes or placeholder tests were added. No runtime tests, builds or screenshots were run because there is no behavior implementation to exercise. CLI/SDK parity, budget/ownership/replay gates and installed artifact bundling remain unverified. Local commits: none. Verified remote-main delivery: none. Successful releases: none. No publication was performed. Unrelated edits and existing gate statuses were preserved.

## Behavior task diff review

Revalidated on 2026-09-21 for the implementation and review request. `rg --files packages` still contains no files under either proposed parser directory or `packages/safe-bash-command-pdfinfo`; searches of the root manifest, safe-bash manifest and bundle script still find no pdfinfo/parser integration. The parser page-tree, security and API implementation/refactor/test gates remain explicitly open.

The current pdfinfo plan diff changes `behavior-pdfinfo` implementation to `done` (line 62), in addition to the engine completion claims. This is an unresolved blocking finding: no behavior source, tests or installed export exists to support that status. The pre-existing contributor changes were preserved. All behavior acceptance cells remain open regardless of the plan status.

There is no behavior code diff to simplify or validate for unnecessary abstractions, proxy-only functions, duplication, unsafe host access or compatibility regressions. Failure paths, explicit cancellation, invocation cleanup, input/decoded/retained/output accounting, parser work/recursion, ownership and snapshot/version compatibility remain unverified rather than accepted. Full original native fixture/output receipts are also still missing as recorded in the acceptance matrix; supplied fragments do not close exact-output cells.

Only this review record was updated. No code changed, so no runtime checks or screenshots were run. The next executable increment remains qualification of the shared parser APIs before dependent pdfinfo integration, as required by the task and plan execution rule. No commits, pushes or releases were performed.

## Current behavior request: adjacent implementation check

Rechecked the current working tree for the renewed `behavior-pdfinfo` request. Source inventory still finds no shared PDF parser or pdfinfo command package, and the root manifest, Safe Bash manifest and bundle script contain no pdfinfo/parser integration. The original package-pattern document remains deleted; its archived copy was inspected without restoring unrelated edits.

The newly present `packages/safe-bash-command-pdftotext` is not a parser prerequisite implementation. Its result contract explicitly declares `extractionQualified: false`; its ordinary execution path raises `Qualified PDF font/text/layout engine is unavailable` before any extraction. Its exported admission, encoding and bounding-box serialization helpers do not provide resolved PDF objects, inherited page geometry, metadata streams or password authorization. This adjacent package therefore does not change the prerequisite finding.

No runtime implementation or missing-module test was added. The task's parser prerequisite and the plan's execution rule still prevent dependent integration. The next required work is first-party shared-parser qualification, not an empty command scaffold or byte-substring metadata reader. All behavior matrix cells remain open. Runtime tests, lint/build gates, CLI screenshots, installed-consumer checks and replay/realm qualification were not run; there is no pdfinfo candidate to exercise. Only this evidence record changed, and unrelated edits were preserved. No commits, pushes, releases or publication were performed.
