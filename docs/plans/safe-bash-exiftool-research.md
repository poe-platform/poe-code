# ExifTool 13.59 behavior and acceptance contract

Research task: `research-exiftool`. This document pins native behavior; it does not admit a product implementation or claim universal ExifTool parity. Independent execution steps are in [the compatibility QA](safe-bash-exiftool-compatibility-qa.md). Engine, behavior, package integration and packed-consumer tasks remain open.

## Inspection and evidence provenance

Inspected local `main` at `052940a62255aa620236474575b4003a2df76549` on 2026-09-18. Git tree inspection found no `packages/safe-bash-command-exiftool` or `packages/safe-bash/src/commands/exiftool`; searches of safe-bash source, tests and package exports found no ExifTool implementation. The existing `safe-bash-exiftool.md` is a draft with native observations, not runtime support. No runtime gap was repaired. Unrelated working-tree edits were preserved.

Authoritative upstream: ExifTool **13.59**, commit **2200871d9cef988051d2a99d67df3bda6cbb30a8**. Archive: `https://codeload.github.com/exiftool/exiftool/tar.gz/2200871d9cef988051d2a99d67df3bda6cbb30a8`. SHA256: **e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5**. Download and hash were independently verified this session; both CLI and library version declarations are 13.59. Source inspection and fresh native controls below used that archive. Temporary evidence used repository `out/research-exiftool` because filesystem-root `/out` is read-only, and was purged after review.

Evidence classes: **fresh** means executed this session; **supplied** means the task/existing plan reports execution but original capture files were not supplied; **source** means inspected pinned source; **pending** means an independent control is still required. Supplied lengths/hashes are retained as reference assertions, never represented as freshly reproduced fixture bytes.

| Source owner at pinned commit | Contract responsibility |
| --- | --- |
| `exiftool` | Argument precedence, FormatJSON/EscapeJSON, CLI Printable, PrintCSV, ScanDir, FilterArgfileLine, publication and ready protocol |
| `lib/Image/ExifTool.pm` | ExtractInfo, GetValue, SetFoundTags, tag priorities, ValueConv/PrintConv, format admission |
| `lib/Image/ExifTool/Exif.pm` | TIFF IFD/endian/offset/type handling |
| `lib/Image/ExifTool/XMP.pm` | Namespace identities, flattened/structured properties, lists and language alternatives |
| `lib/Image/ExifTool/PNG.pm` | Chunk/text readers and writers |
| `lib/Image/ExifTool/OOXML.pm` | Office property extraction; absence of Office write support |
| `lib/Image/ExifTool/PDF.pm`, `WritePDF.pl` | PDF Info/XMP and reversible incremental edits |
| `lib/Image/ExifTool/RIFF.pm`, `HTML.pm` | WebP container metadata and HTML extraction |

Specification is the versioned CLI POD plus these source tables and observed bytes. Link base: `https://github.com/exiftool/exiftool/blob/2200871d9cef988051d2a99d67df3bda6cbb30a8/`. Adaptation requires a selected upstream dual-license/attribution audit; downloading an oracle does not authorize shipping Perl.

## Argument and serialization contract

| Arguments | Pinned interaction / acceptance rule |
| --- | --- |
| Requested `-Title`, qualified `-PNG:Title` | Filter tags, not a new schema. Preserve request order, group identity and native priority; case/shortcut/wildcard interactions require separate controls. Missing tags omitted by default. |
| `-s`, `-S`, `-s3` | Short tag names aligned to the native field width; compact `Name: value`; values with LF, respectively. Plain display uses CLI Printable: remove NUL, map 01–1F/7F to dots, trim trailing whitespace. Explicit escape options require their own controls. |
| `-G`, `-G1:4`, `-G4` | Default group family 0; family 1 location and family 4 instance can distinguish collisions. Preserve actual group tokens, including an empty family-4 winner prefix. Family 0–7 combinations remain qualification cells. |
| `-a` | Extract duplicate tags, ordered by source/priority rules. Repeated PNG Title: ordinary winner second, `-a -s` first then second. |
| `-j` with `-a`/`-G` | JSON enables duplicate extraction but suppresses identical emitted member names. Group qualification is required to expose collisions. Preserve `SourceFile`, member order, indentation and final LF; never serialize duplicate identity from a collapsed JS object. |
| `-j -api StructFormat=JSONQ` | Force scalar string serialization, including boolean-looking text. This is an output policy, not a conversion of stored tag types. |
| `-n`, requested trailing `#` | Disable PrintConv globally/per tag; ValueConv still applies. Neither means raw bytes. |
| `-b` | Raw/binary output without implicit final terminator; list separator defaults to newline. JSON binary/invalid-UTF8 base64 behavior must be separately qualified. |
| `-f` | Requested missing tag placeholder `-`; preserve the exact name and display alignment. |
| `-struct`, `-sep SEP` | Default XMP flattening; structures and singleton arrays retained with struct mode. `-sep` joins lists, including in JSON. Alt language selection and qualified language writes require independent controls. |
| `-TAG=VALUE`, final `-TAG=` | Scalar repeated assignments last win; final empty assignment deletes. Explicit groups determine destination; unqualified writing is governed by registry priority, not by the output key. |
| `-TAG+=VALUE`, `-TAG-=VALUE` | Tag-specific list/shift/removal operations, not generic concatenation/subtraction. Supplied PNG Title shift fails; matching subtraction removes only the matching duplicate. |
| `-all=` | Delete writable metadata selected by native rules; preserve image/document content. Not a universal byte eraser, redaction or guarantee that every protected tag can be deleted. |
| default write | `_original` backup, retaining an already existing backup; replacement publication changes identity. |
| `-overwrite_original` | Suppress backup; replacement identity. |
| `-overwrite_original_in_place` | Suppress backup; preserve identity so hardlink aliases observe changes. Refuse when VFS cannot faithfully supply this capability. |
| `-o DEST` | Create a destination while preserving input; existing destination refuses overwrite. Directory/template/extension interactions remain pending. |
| `-d FORMAT` | Date output/input formatting is distinct from tag storage and ValueConv. No ambient timezone or host locale. Qualify explicit-offset, offset-free, subsecond, invalid and boundary dates against native controls before admitting a format directive. |
| `-charset [TYPE=]CHARSET`, `-L` | Default external text UTF-8; `-L` selects Latin-1. Internal EXIF/IPTC/ID3/filename encodings are separate policies, not one TextDecoder. Qualify malformed UTF-8, Latin-1, UTF-16 BOM/endian, XMP XML encoding and PNG tEXt/iTXt/zTXt independently. Native host filename encoding is not VFS authority. |
| `-csv`, JSON/CSV import | CSV buffers all files for union headers: cap total retained records/bytes and header count. JSON import uses SourceFile-specific records/default `*`, exact group/exclusion/`#` semantics. Empty JSON assignment differs from CSV skipped empty. Import and export controls are independent. |
| `-if`, interpolation/config code | Native evaluates Perl expressions. Product must reject explicitly or use a separately reviewed bounded declarative language with documented deviations. No eval, Function, transpilation or ambient config modules. |
| `-stay_open`, `-executeN` | Invocation-local bounded protocol, `{readyN}` per batch; retain batch condition/error semantics. No ambient file polling. Exact batch ordering/diagnostic routing is pending independent execution. |

Statuses: 0 success; 1 errors; 2 when all files fail `-if`, including execute-batch accounting. No-file, partial-success, malformed-option and mixed read/write cases need their own exact output controls; do not collapse every nonzero result to 1.

JSON scalar lexical rule from EscapeJSON: optional minus; one digit or nonzero-leading integer of at most 15 digits; optional fraction of 1–16 digits; optional case-insensitive exponent with optional sign and 1–3 digits. Matching spellings are emitted unchanged. Case-insensitive true/false become lowercase booleans. Other scalars are quoted. NUL is removed; control escapes use uppercase hex, with tab/LF/CR short escapes. Invalid UTF-8 repair and binary base64 prefix are separate paths. JavaScript Number/JSON.stringify is not byte-equivalent.

| Supplied scalar input | Ordinary JSON token | JSONQ token |
| --- | --- | --- |
| `true`, `FALSE` | `true`, `false` | `"true"`, `"FALSE"` |
| `null`, `NaN`, `Infinity` | Quoted original text | Quoted original text |
| `001`, `+1`, `01.0`, `0x10` | Quoted original text | Quoted original text |
| `-0`, `1.0`, `1e309`, `1e999`, `1E-003` | Exact numeric spelling | Quoted original text |
| `1e1000`, `1234567890123456`, `0.12345678901234567` | Quoted original text | Quoted original text |
| `123456789012345`, `0.1234567890123456` | Exact numeric spelling | Quoted original text |
| a + NUL + b + 01 + 7F | `"ab\u0001\u007F"` | Same escaped string |

These 20 inputs × ordinary JSON/JSONQ/s3 are 60 supplied successful controls with empty stderr. Numeric `1e999` is valid JSON grammar even though JS JSON.parse yields Infinity. SDK values must retain numeric token spelling/text provenance; decoding through Number loses the pinned contract.

## Format/tag acceptance matrix

All product reader/writer cells are **not implemented** at inspected main. Native capabilities below define intended qualification scope, not permission to claim a whole format supported after one tag passes. Every named tag requires independent extraction, qualified identity, conversion, deletion, serialization and applicable write cells.

| Format | Initial explicit tags/containers | Native read / write target | Independent controls still required |
| --- | --- | --- | --- |
| PDF | PDF:Title, Author, Subject, Keywords, CreateDate, ModifyDate; XMP-dc:Title/Description/Subject | Read + incremental write; supplied Title/delete/restore controls | Info vs XMP priority; xref/streams/encryption; original-prefix and corrupted-suffix behavior; dates/encodings |
| JPEG | EXIF:Make, Model, Orientation, DateTimeOriginal, CreateDate, ModifyDate, ImageDescription; XMP-dc:Title/Subject; IPTC:Keywords | Read/write source target; pending execution | APP1 EXIF/extended XMP, ICC/unknown APP segments; preserve compressed image bytes; per-tag conversion/priority |
| TIFF | Same EXIF/XMP set; multipage IFD identity | Read/write source target; pending execution | Both endians, inline/offset values, rationals, cycles; strip/tile preservation; BigTIFF independently staged |
| PNG | PNG:Title, Author, Description, Comment, Copyright, CreateDate, ModifyDate; XMP equivalents | Read/write; supplied writes and fresh basic reads | tEXt/zTXt/iTXt/eXIf, CRC, language, compression; unknown chunks and pixel payload unchanged |
| WebP | EXIF set above; XMP-dc:Title/Subject; RIFF dimensions | Read/write source target restricted to WebP, not all RIFF | VP8/VP8L/VP8X, padding/length/flags, animation, unknown chunks; decoded pixels are not preservation evidence |
| DOCX | OOXML core Title, Subject, Creator, Keywords, Description, Created, Modified; app/custom properties | Read-only; supplied native Title write rejection | ZIP limits, duplicate entries, app/custom types, embedded properties; byte-identical refusal |
| PPTX | Same core/app/custom properties with presentation counts | Read-only target, write rejection independently pending | Extract and write-refusal controls distinct from DOCX |
| XLSX | Same core/app/custom properties with workbook properties | Read-only target, write rejection independently pending | Extract and write-refusal controls distinct from DOCX/PPTX |
| HTML | HTML Title, Author, Description, Keywords, named meta properties | Read-only source target; pending execution | Entity/charset handling, repeated meta, malformed HTML; write refusal distinct from XMP |
| XMP sidecar | XMP-dc:Title/Description (Alt), Subject (Bag), Creator (Seq); XMP-xmp:CreateDate/ModifyDate; bounded structured property fixture | Read/write source target; supplied basic read/list controls | Namespace aliases, default/qualified languages, singleton structures/lists, unknown RDF preservation |

Additional native formats remain visible and **staged, unqualified**: camera RAW families, maker-note catalogs, HEIF/AVIF, QuickTime/video/audio, ICC, PSD, archives and other native formats. Extensive maker-note and catalog parity cannot be closed by a tiny JSON reader. BigTIFF, encrypted PDF and advanced structured schemas also need separate admission. No Office editing extension is authorized by native read-only parity.

## Exact fresh controls and reconstructible fixtures

Fresh fixture `metadata.png`: PNG signature; IHDR width/height 1, bit depth 8, color type 6, compression/filter/interlace 0; tEXt `Title\0first`, `Title\0second`, `Author\0123` (NUL then ASCII 123); IDAT is zlib-compressed five zero bytes (filter byte + RGBA); IEND empty. Every chunk has big-endian length and CRC32 over type+payload. Place text **before IDAT**. Compression byte identity is not a cross-zlib-version assertion; readers compare semantic and preservation controls separately.

All invocations: `perl PINNED/exiftool -config '' ARGS metadata.png` in the fixture directory. Below strings use JSON escape notation; spacing/LF is exact. All have empty stderr, except the explicitly noted alternate chunk-order control.

| Args | stdout string | status |
| --- | --- | --- |
| `-j -Title` | `"[{\n  \"SourceFile\": \"metadata.png\",\n  \"Title\": \"second\"\n}]\n"` | 0 |
| `-a -s -Title` | `"Title                           : first\nTitle                           : second\n"` | 0 |
| `-S -Title` | `"Title: second\n"` | 0 |
| `-s3 -Title` | `"second\n"` | 0 |
| `-b -Title` | `"second"` | 0 |
| `-G -s -Title` | `"[PNG]           Title                           : second\n"` | 0 |
| `-j -G4 -Title` | `"[{\n  \"SourceFile\": \"metadata.png\",\n  \"Copy1:Title\": \"first\",\n  \":Title\": \"second\"\n}]\n"` | 0 |
| `-j -G1:4 -Title` | `"[{\n  \"SourceFile\": \"metadata.png\",\n  \"PNG:Copy1:Title\": \"first\",\n  \"PNG:Title\": \"second\"\n}]\n"` | 0 |
| `-j -api StructFormat=JSONQ -Author` | `"[{\n  \"SourceFile\": \"metadata.png\",\n  \"Author\": \"123\"\n}]\n"` | 0 |
| `-f -s -MissingTag` | `"MissingTag                      : -\n"` | 0 |
| `-s3 -if 0 -Title` | `"    1 files failed condition\n"` | 2 |

Alternate fixture order IHDR/IDAT/three tEXt/IEND, `-f -s -MissingTag`: same stdout/status, stderr `"Warning: [minor] Text/EXIF chunk(s) found after PNG IDAT (may be ignored by some readers) [x3] - metadata.png\n"`. This is a native research control; product Perl predicates remain excluded.

## Supplied write/publication/PDF reference cells

The existing plan records exact read diagnostics for empty (`Error: File is empty - empty.bin\n`, status 1), absent (`Error: File not found - missing.png\n`, status 1) and unknown nonempty (`""` stdout/stderr, status 0 with selected tags). Retain these as supplied controls. Uncaptured full write stdout/stderr must be captured independently; phrases/lengths below are not complete golden streams.

PNG duplicate Title assignment collapses to one; empty deletes both; `all=` leaves a 69-byte metadata-free image in the supplied fixture. Default backup matches the supplied 212-byte original exactly. Repeated scalar assignments last win, including final deletion. `Title-=first` retains second. `Title+=extra` exits 1, unchanged bytes, warning phrase `Shift value for XMP-xmp:Title is not a number`, then `Nothing to do.`. DOCX Title write exits 1 with `Writing of DOCX files is not yet supported`, zero updated/one error; do not infer PPTX/XLSX captures from this case.

Default/overwrite replace inode, hardlink alias retains original bytes; in-place retains inode and alias observes edit. Existing `_original` sentinel is retained while update succeeds. Existing `-o` destination refuses with status 1 and preserves both files; new `-o copy.png` exits 0 with `1 image files created`. All 14 supplied PNG outputs preserve exact IHDR/IDAT/IEND including CRCs. Permissions, concurrent publication and unsupported identity capabilities remain additional controls.

Supplied PDF original is 421 bytes, SHA256 `65f003322d9f09229171c3db5fadb933f2dc50570c6736ac3aaba41343a5519c`, catalog/pages/page with Info Title `original-secret`, Author `Alice`. Title update is 3696 bytes; second edit 3694 bytes replaces prior ExifTool suffix. `all=` is 651 bytes, no reported Title/Author, but `original-secret` remains in bytes; status 0 with reversible-edit warning. `PDF-update:all=` restores exact original bytes/metadata, status 0. Repeating restore exits 1 with `File contains no previous ExifTool update` and unchanged bytes. Source writer validates the suffix begin marker and reuses previous Size/Info objects. Exact original offsets/body bytes were not supplied: a new memory fixture must derive correct xref offsets and earn its own hash rather than pretend to reproduce this hash from lengths alone. Metadata deletion is never irreversible sanitization.

## Product boundary and implementation handoff

Follow [the package pattern](safe-bash-command-package-pattern.md): logic belongs to `packages/safe-bash-command-exiftool`, package name `safe-bash-command-exiftool`, `private: true`, TypeScript ESM, no external runtime dependencies. Do not create an empty package for this research task. Future opt-in API is `@poe-platform/safe-bash/commands/exiftool`; safe-bash composes/exports only. Builder owner is `packages/safe-bash/scripts/build.mjs`; artifact/declaration owner is `scripts/package-safe.mjs`. Private-workspace profiles, maintained dependency DAG, integration boundaries and packed declarations need admission; no command→safe-bash cycle, bare unpublished specifier or duplicate runtime brand owner. Current unrelated contracts/build edits are not evidence that ExifTool is integrated.

Declarative versioned tag/format registry must separate read/write permissions, native tag identity/group/index/offset, stored bytes, ValueConv and PrintConv. Preserve unknown metadata and nonmetadata bytes. CLI and SDK share the same admitted engine and lexical serialization policy. Byte argv must retain canonical brands and provenance.

VFS supplies file bytes/stat/identity/permissions explicitly. No host executable, ambient config/stat/user/group/timezone, implicit network, external utility, native/WASM fallback, dynamic download or product Perl. Register idempotent invocation cleanup before acquisition; propagate cancellation to VFS/streams, await sink backpressure and cleanup, preserve replay/realm ownership. Admission must bound input/output/retained bytes, file/tag/duplicate counts, TIFF depth/offset visits, XML nodes/text/depth, ZIP expansion, chunk lengths, PDF objects/revisions and batch/CSV retention before allocation. Failed/cancelled publication must preserve the documented completed-effect boundary; no invented transaction guarantees.

Implementation uses failing memory-VFS/memfs tests before code; independent compatibility fixtures/goldens must not be generated by the engine under test. Required packed-consumer checks exercise actual Shell-created byte argv, constructor/brand identity, CLI/SDK equality, isolated export imports and declarations with no private workspace installed. No publish, push or release was performed for this research task.
