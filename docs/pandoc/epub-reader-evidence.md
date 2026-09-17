# Original TypeScript EPUB input evidence

Validated on 2026-09-16 in packages/pandoc. No native converter or Office OPC graph
is involved. The existing safe-bash adapter dispatches to the SDK unchanged.

## Tests and checks

- Red: initial 13 tests failed with the absent EPUB reader capability. Subsequent
  original cases reproduced extraction URI/key mismatches, lost body/list targets,
  missing non-spine notes, flattened navigation, lost cover landmarks, encoded
  fragment mismatch, duplicate note prose and namespace-confused attributes.
- Green: `npm test --workspace=@poe-code/pandoc`: 27 files, 867 tests passed,
  including 26 original EPUB tests. Existing HTML tests validate the shared tree
  mapper extraction; recovery remains confined to HTML input.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint and both source/test
  TypeScript checks passed.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: passed, building
  the declared Office ZIP codec dependency and Pandoc. No runtime fallback.
- `git diff --check`: passed.
- Visual QA: [format list screenshot](epub-format-list.png), rendered through
  scripts/screenshot.ts and visually inspected. Shows sorted EPUB availability
  through the built thin adapter. QA steps are in docs/plans/pandoc-epub-reader.md.

Unit archives are original in-memory fixtures. Mutations to the extraction VFS use
memfs. Tests use no downloaded fixtures, LLMs or external executables. Independent
literal SHA-256 expectations check cover bytes `abc` and unused media `hello`:

| Asset | Expected SHA-256 |
| --- | --- |
| Book/Images/cover art.png | ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad |
| Book/Images/orphan.png | 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824 |

## Verified scope

EPUB-specific manifest/spine model; strict SAX XML namespaces; container rootfile
selection; EPUB2 NCX and EPUB3 nested TOC/landmarks; Dublin Core metadata and legacy
cover metadata/guide; raster MediaBag including unused images; canonical nested,
percent and Unicode paths; ordered chapter Divs with source/item/linear/language
attributes; globally scoped fragment targets and cross-chapter links; inline notes
with provenance, including admitted XHTML outside the spine and nested definitions.
Spine chapters retain their original order, including non-linear entries.
Body language scope and unfamiliar inline fragment targets are also exercised.

The bounded ZIP codec validates payload CRCs, rejects traversal, ambiguous duplicate
names and ZIP encryption. Reader checks reject DTD/external entities, missing spine
parts, EPUB encryption/DRM/font obfuscation, cyclic fallback/note dependencies and
fixed layout. Parts/expanded bytes, XML depth/nodes, dependency work and note copies
are bounded by the existing conversion context. Remote links remain passive links;
remote images and scripts are diagnosed/dropped, with no fetch or execution.

## Limits of this evidence

These original fixtures cover the requested upstream MediaBag/cover behaviors;
they are not an upstream corpus run or universal EPUB conformance proof. First
supported rootfile selection diagnoses additional renditions. UTF-8 is the admitted
XML encoding. Missing media, CSS/layout refinement losses, foreign media, SVG
rendering and media-overlay synchronization are diagnosed explicitly. Fixed layout
and encryption are rejected. No new SDK/CLI flags or environment variables were
added. The package README was preserved under the root permission rule.

Delivery is local only. No remote-main verification, push or release was requested.

## Navigation verification follow-up (2026-09-16)

Current main already contained the reader and its 26 original tests. Three new
original in-memory tests first failed: compatibility NCX displaced EPUB3 nav;
non-spine navigation generated a nonexistent assembled fragment target; and a
missing admitted navigation resource was accepted. They now pass. EPUB3 nav takes
precedence, external-to-spine admitted targets keep canonical resource URIs, and
missing navigation parts fail with EPUB source/part location.

Maintained verification: `npm test --workspace=@poe-code/pandoc` passed 1061 tests
across 47 files, including 29 EPUB reader tests. Package lint/typecheck and
`npm run build:workspaces -- --workspace=@poe-code/pandoc` passed. Existing original
cover/unused-media hash assertions and memfs extraction tests still pass.

Visual QA: [built adapter format list](epub-reader-format-verification.png), made
with the maintained screenshot renderer and inspected; EPUB is present, readable
and unclipped. No adapter, CLI design or native runtime fallback was added.

## Foreign namespace verification follow-up (2026-09-16)

Two additional original in-memory tests reproduced foreign XML defining XHTML
fragment IDs and introducing note dependencies despite being dropped by the
namespace-aware XHTML mapper. The dependency/fragment scanner now skips the same
foreign subtrees. Strict SAX parsing and foreign media loss diagnostics remain.

Final maintained checks: 1063 tests in 47 files passed, including 31 EPUB reader
tests; package lint/typecheck and the selected workspace build passed again.
The cover and unused-media SHA-256 expectations, ordered chapter AST assertions,
memfs extraction, malicious archive/XML rejections and thin adapter test pass.

Visual QA uses an original in-memory publication from the TypeScript EPUB writer
through the built thin safe-bash adapter (`-f epub -t plain`), rendered using the
maintained screenshot command into [conversion output](epub-reader-conversion-verification.png).
Inspected: chapter/prose and explicit CSS loss warnings are legible and unclipped.
Unit tests use no host scratch files, executables, downloads or LLMs.

Additional manual QA with the larger existing `epub3-qa/original.epub` book
(about 110 KB expanded, including a 78 KB chapter) hit the default 1,000,000 work
quota and returned exit status 7. An attempted 5,000,000 work override was rejected
as an invalid limit: context overrides can tighten the quota, not raise it. This
book is not claimed as a successful conversion; the bounds remain enforced.
