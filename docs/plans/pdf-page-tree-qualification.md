# PDF page-tree candidate qualification

Status: draft. This receipt covers only the first-party page/metadata graph
increment, not mature PDF 1.0–2.0 support or prerequisite/dependent gates.

Implementation: `packages/pdf-parser/src/pages.ts`, exposed as
`PdfDocument.inspectPages` through the existing private engine. The manifest
remains private with an empty runtime dependency graph. No upstream source,
native process, WASM, font asset or network/file capability was adopted.

Architecture references supplied for this task remain pinned: PDF.js
`579c4b700f23f7782234f03358b5e9eaa3f58889` (Apache-2.0), pdf-lib
`93dd36e85aa659a3bca09867d2d8fac172501fbe` (MIT), qpdf
`54d6053af283bbeb8b325f4886c0f65cc51f2b80`, MuPDF
`89c1d183a7fb724898b2017d6ecd402a61886d4f` (AGPL/commercial), Poppler
`0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46` (GPL). These are design context,
not executed compatibility oracles or authorization to copy licensed code.
The engine's existing first-party MIT license is unchanged.

## Candidate behavior

Ordered indirect page-tree traversal validates Catalog/Pages/Page types, parent
references, duplicate nodes and exact subtree counts. Inherited geometry and
resources preserve original objects alongside effective unrotated boxes and
normalized rotation. CropBox intersects MediaBox; inverted or disjoint effective
boxes fail. BleedBox/TrimBox/ArtBox are page-local with CropBox defaults.

Info dictionaries and string encodings remain byte-preserving syntax objects.
XMP exposes original stream bytes and filter-decoded bytes without XML execution.
Outline sibling/parent/Last links and visible counts are validated. The flat
inventory includes closed descendants. Links retain inert actions/destinations;
attachments retain file-specification/embedded-stream objects, deduplicating
indirect file specifications across discovery paths. Forms inherit field type
and value and retain raw dictionaries and parent references. Unknown objects
remain accessible through the original lazy object API. Inventory does not
execute JavaScript, XFA, XML entities, launch actions or network links.

Shared document work, retained-allocation, syntax-object and expanded-byte
quotas remain cumulative across calls. Graph node admission is additionally
bounded by `maxNodes`, and recursion by the admitted nesting ceiling (at most
128). Nodes are admitted before retention/traversal; byte/name/key comparisons
charge work. Cancellation is checked through the shared owner during traversal
and decoding, and propagates its exact reason. LIMIT/UNSUPPORTED/REFERENCE and
cancellation never become page recovery warnings. Encrypted or recovered
document interpretation fails explicitly; raw object inspection remains separate.

## Original in-memory evidence

`src/pages.test.ts` was introduced before the API; the missing method produced
three failing cases. Additional failing controls preceded page-local boxes,
explicit page count and integer-token validation. Fixtures construct bytes in
memory, without files, LLMs, native oracles or external capabilities.

Controls cover ordered pages; nested inheritance and empty-resource override;
CropBox clipping/defaults; local boxes; negative/over-one-turn rotation; Info
non-Unicode bytes; XMP bytes; inert link actions; outlines including closed
branches; attachments; inherited form type; input/result ownership; sampled
chunk boundaries; graph/repeated-read quotas; malformed geometry;
Catalog/Pages type errors; page/outline/form parents and counts; duplicate nodes;
page/name-tree/outline/form cycles; noninteger count syntax; and pre/mid-traversal
cancellation. These controls independently qualify this candidate behavior,
not Poppler/qpdf equivalence.

Verification receipt (2026-09-21):

- `npm test --workspace=pdf-parser`: exit 0; 62 tests passed, no skips or failures,
  including 13 page-tree cases. Direct package execution is fresh.
- `npm run lint --workspace=pdf-parser`: exit 0; ESLint and both source/test
  TypeScript checks passed.
- `npm run build:workspaces -- --workspace=pdf-parser --no-cache`: exit 0;
  maintained selected-workspace build, explicitly uncached.
- `git diff --check`: exit 0. New files additionally passed package lint/types.

Repository-wide tests, installed command artifacts and actual browser/workerd
runtimes were not exercised by this isolated engine receipt. No CLI behavior
changed, so visual CLI screenshot qualification is not implicated.

## Independent gates still open

Strict malformed-graph rejection is the current page interpretation profile;
producer repair is not silently inferred. Unicode/PDFDocEncoding interpretation,
XFA rendering, external file specifications and linked content, optional-content
semantics, tagged structure/reading order, font/text interpretation, encrypted
inventory, lossless rewriting and broad upstream corpus/runtime compatibility
remain separate gates. Raw metadata encoding is not a claim of decoded Unicode.
No page gate closes revision/filter/security gates from earlier increments.

The requested command pattern now resides at
`docs/plans/archive/safe-bash-command-package-pattern.md` in the existing working
tree. This increment adds no command exports or registration and changes no
dependent command behavior. Dependent commands must declare the private engine
edge and bundle its required first-party source through maintained artifact
admission; no ambient unpublished import is authorized. Installed Safe Bash
artifact integration and release qualification are not established by engine
tests. No external parser adoption is proposed.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or publication was performed.

## Task review receipt (2026-09-21)

Reviewed page traversal and its document-owner integration for proxy-only
functions, duplicated interpretation, host access, raw-object ownership,
cancellation, cumulative quotas and compatibility. No external source or runtime
dependency was introduced. The one validated compatibility finding was rejection
of null optional dictionary entries, including indirect nulls and null inherited
attributes. Two original in-memory regression cases failed before the fix.
Structural lookups now treat null as absent, retaining the original entries in
raw dictionaries. A focused optional-field helper checks indirect nulls through
the existing bounded resolver; opaque actions and destinations remain untouched.
A third control preserves unresolved action/destination references in both link
and outline inventories, demonstrating that inventory does not interpret them.

After the fix, `npm test --workspace=pdf-parser` passed all 65 cases (16 page
cases), `npm run lint --workspace=pdf-parser` passed ESLint and source/test
typechecks, and the explicitly uncached maintained selected-workspace build
passed. `git diff --check` passed. No CLI visuals or snapshot formats changed.
Other contributors' changes were preserved. No unresolved implementation finding
was established within this page-tree review. The independent gates and installed
Safe Bash artifact/runtime qualification limitations above remain open; this
receipt does not close them or claim mature PDF support. No commit, push or
release was performed.

## Independent page-tree controls (2026-09-21)

Candidate is the current working tree, not a committed/released revision. This
review adds three original in-memory controls to the existing page implementation.
The indirect-null form-value control failed before the fix: the interpreted value
was a reference instead of the inherited byte string. Form value inheritance now
uses the same bounded null-aware structural lookup as other inherited attributes;
the raw child dictionary still contains its original reference. An empty page
root with Count 0 is admitted without inventing page geometry. Unsupported
attachment filters remain opaque during inventory; explicitly decoding their
payload fails with UNSUPPORTED. Required XMP decoding fails with UNSUPPORTED while
its original bytes remain available through getObject. No external oracle ran.

Manual QA plan for the built private SDK:

1. Import dist/index.js with process, Buffer and fetch unavailable during SDK use.
2. Supply an original byte fixture containing an empty Pages root with Count 0.
   Check pageCount 0, empty inventories and the retained raw Pages dictionary.
3. Repeat with maxNodes 0 and check fatal LIMIT; no successful partial result.
4. Abort with a falsey reason and check that the exact reason propagates.
5. Restore temporarily hidden host globals even if a check fails.

Fresh package tests passed all 68 cases with zero failures/skips after the fix;
package lint passed ESLint and source/test TypeScript checks. The initial test
run failed one newly added regression (67 passes); it was investigated and fixed,
not treated as an unrelated failure. This isolated engine change does not alter
CLI visuals, exports, checkpoints or replay. Repository-wide checks, upstream
compatibility/runtime matrices, installed Safe Bash artifacts and browser/workerd
execution remain unverified. No independent prerequisite/dependent gate closes.
No commit, push or release was performed by this review.

The explicitly uncached maintained selected-workspace build passed. The five
Markdown QA steps above passed against dist/index.js: empty page graph and raw
view, fatal zero-node quota, exact falsey cancellation, with process/Buffer/fetch
unavailable during SDK use and restored in finally. This is a Node host-capability
negative control, not an independent browser/workerd realm qualification.
`git diff --check` passed. No temporary evidence files were created.
