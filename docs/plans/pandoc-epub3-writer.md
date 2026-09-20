# EPUB 3.3 writer

Implement only original TypeScript EPUB3 output in packages/pandoc; shared ZIP
codec, existing thin safe-bash adapter, no native fallback. Preserve other edits.

1. Write original failing tests with independent local ZIP and namespace-aware
   XML assertions, then implement aliases, metadata, chapter/ID allocation,
   navigation, bounded original CSS, cover and declared raster resources.
2. Verify archive/manifest/spine order, Unicode paths, duplicate headings,
   empty/long books, internal closure, rejected active/orphan/missing media,
   reproducibility, budgets and adapter output. Unit I/O stays in memory.
3. Run maintained pandoc test/lint/build closure. Execute QA below; record actual
   outcomes and artifacts under docs/pandoc. Commit explicit owned files on main;
   do not push.

## Recorded profile and reproducible defaults

EPUB 3.3, single reflowable rendition, OPF version 3.0, UTF-8 XHTML, no scripts,
remote media, fonts, SVG or user CSS. Original fixed stylesheet under 2 KiB.
Metadata keys title, lang, identifier, modified, cover-image accept text; title
and lang also accept MetaInlines. Defaults: Untitled, en (document.language takes
precedence over default), modified 2000-01-01T00:00:00Z. Identifier defaults to
urn:sha256 of ordered generated publication parts and declared media bytes.
Explicit identifier identifies an edition; content defaults identify identical
publications identically. No clock/random calls. Cover-image names an explicit
MediaBag key; no ambient resource lookup. PNG/JPEG/GIF are the admitted media.
All declared resources are packaged and must be referenced by content or cover;
orphan, unknown, missing and active resources fail. Duplicate explicit IDs fail;
generated heading IDs follow shared HTML allocation, globally before splitting.
Top-level h1 starts a chapter; at a top-level block boundary accumulated text of
64 Ki UTF-16 units also starts a chapter. A single oversized block stays intact.
Empty books have one chapter. Chapter files/OPF IDs use ordered numeric indexes.
TOC includes every heading in document order (flat list preserves heading level
in CSS class); headingless chapters have fallback entries. All fragment links
are resolved after full target allocation, including forward references.
Unknown/missing internal targets fail; external http/https/mailto/tel links are
passive links only. No undocumented warning downgrade.

## QA procedure (external tools only here, never units/runtime)

- Generate an original EPUB with Unicode image path, cover, repeated headings,
  forward/backward links, paragraphs, lists, a table and a long chapter.
- Run pinned EPUBCheck 5.3.0 (record distribution checksum, Java version,
  invocation and complete result). Check empty and long publications too.
- Open the original book in an independent reading application; record version.
  Inspect narrow/wide reflow, navigation/spine order, forward/back links,
  cover/image display and text wrapping. Capture screenshots as evidence.
- Record limitations honestly if tools are unavailable; archive validity alone
  does not establish reading QA. No release/push is authorized.

## Status

- Shared HTML escape prerequisite verified: original long-book test exceeded the
  reference budget; a focused HTML test reproduced the same issue with 200
  references. Bounded 256-unit escape chunks preserve exact entities/Unicode.
  Maintained package suite passed (887 tests), lint/typecheck and build closure
  passed. This prerequisite is its own atomic local commit.
- Shared prerequisite committed locally on main as 30fc3d529.
- EPUB3 implemented; maintained package checks passed: 888 tests across 28 files,
  ESLint and source/test TypeScript checks, selected workspace build closure.
- Pinned EPUBCheck 5.3.0 verified EPUB 3.3 rules on original/empty/long books with
  zero errors. Original Unicode space filename has one retained PKG-010 warning;
  empty and long books have no warnings.
- Independent EPUB.js 0.3.93 archived reading application in Chrome 152.0.7977.84
  verified cover/images, TOC/spine and actual forward/back clicks. Inspected wide
  and narrow reflow screenshots, long prose and table pagination. The upstream
  demo's fixed 900 px viewer was resized to 380 px for the narrow-width check.
  QA tools were removed; original books, screenshots, pinned hashes and actual
  results are recorded in docs/pandoc/epub3-writer-evidence.md and epub3-qa.
- EPUB3 delivered as an atomic local commit on main. No push or release.
