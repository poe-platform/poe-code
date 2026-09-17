# EPUB reader

Implement the original TypeScript reader in packages/pandoc, using the shared
bounded ZIP codec directly, never the Office OPC model or a native converter.
Preserve the unrelated existing Pandoc plan edit.

1. Write original failing in-memory archive tests for ordered chapters, cover and
   media bytes, package selection, navigation, notes, URI identity and rejection.
2. Parse EPUB XML strictly with namespaces and resource/dependency bounds. Assemble
   chapter Divs with canonical provenance and globally distinct fragment targets.
3. Exercise the existing thin safe-bash command and SDK resource extraction in
   memfs; run maintained package tests, lint and selected workspace build.
4. Record evidence in docs/pandoc and commit explicit task files on main. No push.

QA: inspect exact AST chapter order, language, links, navigation metadata and
cover semantics; compare media SHA-256 with independent literal expectations.
Confirm malformed XML, DTD, traversal, ambiguous ZIP names, missing spine,
encryption, fixed layout and recursive dependencies fail deterministically.
Unsupported CSS, media overlays and dropped media must produce diagnostics.

Status: implemented and verified. The original failing capability tests and later
failing extraction, fragment, navigation, external-note and namespace cases were
run before their implementations. Maintained Pandoc tests: 867 passing across 27
files, including 26 EPUB tests. Package lint/typecheck and selected workspace build
(Pandoc plus its declared Office ZIP dependency) passed.

Visual QA used the maintained scripts/screenshot.ts renderer against the built
thin adapter's --list-input-formats output, writing directly to
docs/pandoc/epub-format-list.png. Inspected the image: EPUB is present in the
sorted list, with legible text and no clipped output. No root CLI design changed.
No host file mutations occur in unit tests; extraction uses memfs.

Limitations are explicit: first supported rootfile selected with a diagnostic;
UTF-8 XML only; raster MediaBag assets retained, SVG rendering diagnosed; CSS,
layout refinements, active content and synchronized overlays diagnosed; encryption
and fixed layout rejected. No upstream/native conformance claim, push or release.

## Navigation verification follow-up

The reader already exists on main. Reproduce remaining navigation identity and
selection gaps with original in-memory fixtures, then prefer EPUB3 nav over NCX,
reject missing navigation resources, and retain resource URIs for targets outside
the assembled spine. Validate maintained package tests, lint/typecheck and the
selected workspace build before committing. Inspect the built adapter format-list
screenshot in docs/pandoc. Preserve all unrelated changes; delivery stays local.

Status: three original regression tests failed before the implementation and now
pass. Maintained package tests passed (47 files, 1061 tests, 29 EPUB reader cases),
as did package lint/typecheck and the selected workspace build. The built adapter
format-list screenshot was inspected: EPUB remains visible and text is legible.
