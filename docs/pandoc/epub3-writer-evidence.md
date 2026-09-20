# Original TypeScript EPUB 3.3 output evidence

Verified 2026-09-16. Conversion belongs to packages/pandoc and uses the shared
Office ZIP codec directly. The safe-bash adapter remains unchanged and thin.
There is no native converter, runtime executable, remote-media fetch or ambient
file access in EPUB writing. EPUB2 writing remains unsupported (`epub2` produces
E_FORMAT); `epub` and the directional output alias `epub3` select the same writer.

## Profile and reproducibility

Single reflowable EPUB 3.3 rendition, OPF version 3.0, UTF-8 XHTML, original fixed
stylesheet under 2 KiB, flat ordered heading TOC plus headingless-chapter entries,
optional cover image and cover page/landmark. PNG/JPEG/GIF are admitted with a
matching suffix/signature. SVG, fonts, scripts, user CSS and other media are outside
this profile. Raster signatures are checked; this is not full image decoding or
validation of arbitrary image payloads.

Caller metadata keys `title`, `lang`, `identifier`, `modified`, `cover-image` use
MetaString or MetaInlines (the shared metadata CLI/JSON route exposes them too).
Defaults: title `Untitled`; language document.language, otherwise `en`; modified
`2000-01-01T00:00:00Z`. Supplied modified must have canonical UTC second precision.
Empty required values and invalid language tags fail E_OPTION. A supplied identifier
identifies the caller's edition; otherwise `urn:sha256:` hashes ordered path/length
framed generated parts, media bytes and required metadata, excluding the OPF itself.
Identical publication content has identical identity and archive bytes. No clock
or randomness is consulted. ZIP timestamps are fixed to 2000-01-01 UTC.

IDs are allocated globally by the shared HTML writer before splitting. Duplicate
explicit IDs and IDs containing whitespace fail. A top-level h1 starts a chapter;
64 Ki UTF-16 text units accumulated in a chapter trigger a split at the next
top-level block boundary. Single oversized blocks stay intact. Empty books have
one chapter. File names and spine IDs are sequential numeric chapter indexes.
Nested headings remain within their enclosing top-level block.

The complete DOM target map rewrites forward/backward fragments and note links.
Unknown, malformed and missing internal targets fail E_CAPABILITY. No warning
downgrade is offered. External HTTP(S), mailto and tel hyperlinks remain passive.
Images must name explicit document.resources keys; cover-image names one such key.
Resource identities are resolved before URL escaping, preserving Unicode, literal
percent sequences, spaces and URL syntax hazards. Missing, unsupported, conflicting
or orphan resource declarations fail E_RESOURCE. Every packaged publication resource
is declared in the manifest and referenced by content or cover. No resource resolver
is invoked by the writer. No new environment variables or SDK/CLI flags were added.

## Automated checks

- Original red tests reproduced missing EPUB writer/epub3 alias and absent inventory.
  Long books reproduced per-character HTML reference retention, independently
  reproduced by a focused HTML test before its atomic bounded-chunk fix.
- Subsequent original red tests reproduced literal percent/space/image URL identity
  loss and acceptance of fractional modified timestamps, then verified their fixes.
- `npm run test --workspace=@poe-code/pandoc`: 28 files, 888 tests passed, including
  20 EPUB output tests and the focused shared HTML regression.
- `npm run lint --workspace=@poe-code/pandoc`: ESLint plus source/test TypeScript
  checks passed. `npm run build:workspaces -- --workspace=@poe-code/pandoc` passed
  its declared Office ZIP/Pandoc build closure. `git diff --check` passed.
- Independent local/central ZIP header, size, CRC32, EOCD and deflate assertions
  use no production ZIP reader. Independent namespace-aware SAX XML assertions
  check container/OPF, metadata, manifest/spine order, unique IDs and link closure.
  Tests cover empty/long books, duplicate headings, cover, Unicode/escaped filenames,
  PNG/JPEG/GIF declarations, orphan/missing/active media, notes and publication limits.
  Clock/random spies reject ambient access. Adapter output publication uses memfs.
  Units use no host scratch files, LLMs, downloaded fixtures or external executables.

## Executed QA

Procedures are recorded in docs/plans/pandoc-epub3-writer.md. Three original generated
books and the original cover artwork are retained under [epub3-qa](epub3-qa).
The main book contains Unicode media paths, cover, repeated headings, forward/back
links, original prose, lists, a table and a long chapter.

| Original artifact | SHA-256 |
| --- | --- |
| original.epub | 9a1fa05b3da9f2bd6595b677facf92a7a5497cdf930eff9919f616c90e995f96 |
| empty.epub | 52a243ca41cee2e0b276e838cb6468f06f9303b48f7d12a2e83a79bbeea7ebd6 |
| long.epub | 22eb99c10f6b85e5052a2f4f19a82fc5ecad659fb4945867a50d00ac45bff68f |
| cover-original.png | 63feede9b6ea129f0116f3f809f491dffe50f47670c653e7e1b769be36c031a9 |

EPUBCheck **5.3.0**, distribution SHA-256
`6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5`.
Java: Homebrew OpenJDK 25.0.2 (build 25.0.2). Invocation used the Java executable
`/opt/homebrew/opt/openjdk/bin/java -jar <epubcheck-5.3.0>/epubcheck.jar <book.epub>`.
All three runs explicitly selected EPUB 3.3 rules. Complete results:

- [Original book](epub3-qa/epubcheck-original.txt): zero errors/fatals; one PKG-010
  warning because the deliberate Unicode image filename contains spaces.
- [Empty book](epub3-qa/epubcheck-empty.txt): zero errors or warnings.
- [Long book](epub3-qa/epubcheck-long.txt): zero errors or warnings.

Independent reading application: upstream **EPUB.js 0.3.93 archived example**,
with **JSZip 3.10.1**, running in Chrome **152.0.7977.84**, driven with Playwright
Core 1.58.2 only for QA. The application's original external sample-book and script
requests were intercepted with the original local EPUB and pinned local libraries;
no external sample fixture was downloaded. Source code was not added to runtime or
unit dependencies. The demo's fixed 900 px viewer was explicitly resized to 380 px
for the narrow-width check (420 px viewport); wide viewport was 1100 px.

Pinned QA library tarball SHA-256 values:

| Library | SHA-256 |
| --- | --- |
| epubjs 0.3.93 | 180b33059ca15e2b4f129eb7fef6cae0bf6005c02af5194d13e5cb48378d538f |
| jszip 3.10.1 | 5117f4a2a645aeb307bf3b829c575ad58135cc97e75291e594532ab5b5b21b23 |
| playwright-core 1.58.2 | 50e358de81526d5b20ce75a89c96bdc50ae653f077bbc834ada26d92046ce713 |

[Reader report](epub3-qa/reader-report.json) records spine/TOC, locations, column
widths, loaded images and page counts. The actual forward anchor moved to
chapter-2.xhtml; the actual backlink returned to chapter-1.xhtml. Both duplicate
heading TOC entries have distinct targets. Cover and body images loaded at natural
width 600 px and scaled within the reading column. Original long prose reflowed
from a 66-page wide presentation to 68 narrow pages. Screenshots were visually
inspected for wrapping, legibility, image display, navigation and table pagination:

- [Wide cover](epub3-qa/reader-cover-wide.png) and [narrow cover](epub3-qa/reader-cover-narrow.png).
- [Wide prose](epub3-qa/reader-prose-wide.png) and [narrow prose](epub3-qa/reader-prose-narrow.png).
- [Narrow image/list/table](epub3-qa/reader-image-table-narrow.png); table body continues
  on the [next page](epub3-qa/reader-table-continuation-narrow.png).
- [Forward navigation](epub3-qa/reader-second-narrow.png) and [backlink](epub3-qa/reader-backlink-narrow.png).
- [Wide long chapter](epub3-qa/reader-long-wide.png) and [narrow long chapter](epub3-qa/reader-long-narrow.png).
- [Output format list](epub3-qa/format-list.png), generated with the maintained
  `npm run screenshot -- --output ... -- node ...` renderer against the built adapter.

Downloaded QA tool distributions were removed after use. This proves the recorded
profile on the original books in one independent reading application; it does not
claim universal reading-system compatibility or a general EPUB corpus run. The
space-filename compatibility warning is retained. The package README was preserved.
Delivery is local only; no push, remote-main verification or release is authorized.
