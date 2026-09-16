# PPTX links domain implementation

Scope: ordinary owner-scoped URL relationships, supported internal slide actions,
inert preservation and explicit sanitization, and one mutable in-memory link
session shared by direct operations and model facades. Product code remains in
`packages/pptx`; no host filesystem, network, native runtime or README edits.

## Implementation and test procedure

1. Read root instructions, the PPTX/shared Office contracts, and test/API audits.
2. Add original byte-package and memfs assertions before implementing links.
3. Implement URL/slide/navigation list, set and remove through namespace-aware XML
   merges; retain sibling links, namespaced metadata, unknown subtrees and shared
   relationships. Reuse equivalent owner-local relationships and retain exact
   bytes for identical updates.
4. Read program, macro, OLE and unrecognized actions without executing or
   deleting them. Reject ordinary overwrite; require `sanitize: true` removal.
   Empty inert hyperlink nodes remain editable without sanitization.
5. Resolve explicit slides against the presentation list, distinguish missing
   targets from malformed numeric arguments, and retain targetless navigation.
   Inspect custom-show syntax and membership; malformed/unresolved shows require
   sanitization. Custom-show authoring and cross-deck remapping remain unsupported.
6. Verify existing slide-removal and import behavior: explicit removal policy for
   live targets, relationship remapping for selected slides, safe rejection of
   omitted targets and custom-show merges. The later validated run mouse-over
   guard findings are handled by narrow lifecycle changes described below.
7. Add a bounded link session with synchronous property edits, graph validation
   before commit, cancellation checks, original-snapshot selectors and async save.
8. Verify both dialects and a root-owned slide, exact relative/external targets,
   shape and run-property paths, and shared relationships with independent parsed
   XML attributes. Coordinate CLI and model bridge verification with their owners.

## Evidence

`links.test.ts` first failed for missing module exports. Subsequent original red
regressions exposed byte-changing identical edits, falsely safe malformed custom
shows, missing synchronous session exports, empty hyperlink misclassification,
missing session cancellation, and duplicate equivalent relationships. Each was
implemented after its corresponding failure. Initial shape-link import/removal safety was validated directly. Later independent
review reproduced a run mouse-over guard gap; the narrow lifecycle fixes and
their original failing regressions are recorded below.

Focused validation: `npx vitest run packages/pptx/src/links.test.ts` and related
link action/model tests; `npx eslint` for owned source/tests; package source and
test TypeScript checks. Root owns final maintained package checks and commits.
No pipeline, push or release is part of this task.

Disposable corpus QA uses `docs/pptx/corpus-manifest.json`; root owns the executed
QA receipt. Downloaded assets never enter tests or commits. All domain fixtures
are small original in-memory packages.

## Independent review correction

Primary schema review confirmed that run-property hover links are
`a:hlinkMouseOver` under `rPr`, `defRPr` and `endParaRPr`, whereas shape hover links
use `a:hlinkHover` under `cNvPr`. See the
[run mouse-over definition](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.hyperlinkonmouseover?view=openxml-3.0.1).
Five original failing cases demonstrated incorrect run element spelling/order,
unread run navigation and a macro-action import guard bypass. The domain now
writes run mouse-over before `rtl`/`extLst`, distinguishes owning element scope,
and recognizes actual run mouse-over actions during import and slide removal.
This finding required narrow fixes in `slide-copy-xml.ts` and `slide-removal.ts`.
The table-cell fixture and independent model assertions were corrected by their
owner. No downloaded or upstream assets were used in these regressions.

Three additional red regressions established cancellation for synchronous session
reads and the literal relationship target exposed separately from ordinary URL
classification. These are implemented in the same bounded session domain.

Final domain receipt: 39 original cases pass in `links.test.ts`, including the
misplaced-hover read and explicit-sanitization regression. Related action/import/
removal suites passed together (129 cases at the preceding 38-case checkpoint).
Owned source/test ESLint and both source/test TypeScript checks passed; the final
source TypeScript check also passed after the scope correction. Root performs
final maintained package checks against the frozen worktree before committing.
