# pdfinfo pinned behavior

Task `research-pdfinfo`, inspected 2026-09-21. This specification records evidence and hands off implementation prerequisites. Independent qualification is tracked in [the acceptance matrix](safe-bash-pdfinfo-acceptance.md). No implementation acceptance is claimed.

## Current-main inspection

Branch `main`, HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`. Both `git ls-tree -r --name-only HEAD packages` and working-tree searches of `packages` and `scripts` found no pdfinfo command implementation, tests, manifest, wrapper or export. The existing [pipeline](safe-bash-pdfinfo.md) and [shared parser plan](safe-bash-pdf-parser.md) describe future work. There is no current pdfinfo runtime defect to repair. No empty command scaffold was added.

The requested package-pattern document is deleted by unrelated working-tree edits; its [archived copy](archive/safe-bash-command-package-pattern.md) was read without restoring or modifying it. Existing edits were preserved. This task changes documentation only; no code tests, native process, screenshot, commit, push or release was performed.

## Pin and provenance

Reference: Poppler **0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46**, **26.09.90 development snapshot**. Supplied full-source archive SHA256: `e9834d9e5e9269e241d9638e97e32867cdf56140b87af74d0fb9f58a326e158a`. The archive digest was not independently verified here.

Supplied native controls: macOS, CMake 4.4.3, Freetype 2.14.3, Fontconfig 2.17.1, JPEG; Qt/GLib/CPP/NSS/GPGME/Brotli/Harfbuzz/curl/OpenJPEG/LCMS/Cairo disabled. These qualify the reported basic fixtures, not disabled codec or signature features. Date comparisons require explicit invocation locale/timezone; the supplied UTC date observation is retained below. Reconstructible receipts must also record `LC_ALL` and the platform C library.

Evidence notation: **E** = executed observation supplied by the user, not rerun here; **S** = immutable source inspected here; **D** = required first-party safety/product contract, separate from native equivalence; **O** = open independent qualification. Original fixture bytes, hashes, executable digest and complete per-invocation stdout/stderr receipts were not supplied in the checkout. Reported fragments must not be promoted to full-output goldens.

Source was fetched into memory from the [immutable mirror](https://github.com/tsdgeos/poppler_mirror/tree/0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46); no downloaded executable or runtime dependency was introduced. Fresh source receipts:

| Path | SHA256 | Ownership |
| --- | --- | --- |
| `utils/pdfinfo.cc` | `0c95c73feaa65ffe74cbe4fe26460654fc673ecfca9f096fadfb93f757189de9` | argDesc 96–117; sanitation 119–163; dates 177–244; structure 252–343; destinations 345–451; URLs 453–472; subtype 474–708; custom 710–761; ordinary 763–951; main 953–1102 |
| `utils/parseargs.cc` | `37f1bbb80321a2ab4e2b2515facc35bb8e8f35aa75757361d19e297c6e7377e4` | option consumption, byte truncation, integer grammar |
| `poppler/DateInfo.cc` | `ad47d8def8c00ebf4b3c4f15f4a39c4a63a2c5fa4b4e166e7ded6f35772eb162` | parseDateString, partial fields, legacy date recovery |
| `poppler/UTF.cc` | `f1d707da50b9ceea17c1725bd2bbd4f998cf8d5b740aa922a365196bd2e77a1a` | semantic text-string conversion |
| `poppler/Lexer.cc` | `084e75d40727415ff50ece5447b8feacd39086c6d1a42d2b10c59a51fd200a6b` | UTF8-BOM normalization in literal/hex string paths |
| `poppler/JSInfo.cc` | `09ecd559cb5aa0188301d489f8fd3f4ba2523a42475cb98617466eae35d60584` | inert JavaScript inventory and printing |
| `poppler/StructElement.cc` | `3104dcf51607f1927d6b9931953b6a549f37c1f579ce8e87a2464e617b590606` | logical structure and content helpers |

Document, catalog, page, xref/filter, security, subtype and UnicodeMap owners remain prerequisites; source-file hashes alone do not qualify their behavior. PDF date syntax is identified in DateInfo.cc as PDF Reference 1.3 §3.8.2. PDF 2.0 text-string language escapes and malformed recovery remain separate cells. Do not substitute generic ISO/date libraries for this pinned utility behavior.

## Invocation and exact interactions

S: accepted spellings are `-f -l -box -meta -custom -js -struct -struct-text -isodates -rawdates -dests -url -enc -listenc -opw -upw -v -h -help --help -?`. Integer/string operands are separate tokens. No abbreviations, grouped flags or `--key=value` syntax. Known options are consumed even after a filename until `--`; unknown tokens remain positional. Exactly one PDF operand is normally required. Repeated value options use the last value. Native integer grammar admits empty/sign-only operands before `atoi`; checked complete integer admission in the first-party command must be documented as D rather than falsely attributed to native behavior.

Defaults: first=1, last=0 sentinel; mode flags false. Password arrays retain 32 operand bytes, encoding 127; missing password is a leading byte `01` sentinel. Truncation is by bytes, not codepoints. Embedded NUL is not an executable argv capability; raw SDK values and CLI-compatible values must be explicitly distinguished, with equivalent behavior through the CLI-compatible SDK route. Long/multibyte/sentinel controls remain O.

Main ordering (S):

1. Parse and arity/help/version check. Version/copyright/usage use stderr. Explicit help or version sets status 0 even if parsing failed; malformed invocations otherwise retain 99. `-v` suppresses usage, including when help is also present.
2. `-struct-text` implies structure. `-listenc` returns 0 before selecting `-enc`, opening the PDF or validating page ranges, but does not bypass parse failure. With listenc, ordinary operand-count validation is bypassed. Exact list bytes depend on the qualified encoding profile and remain O.
3. Admit output encoding, then open/authenticate PDF. Invalid encoding returns 99 before PDF-open errors. Input `-` maps to `fd://0` in native; first-party acquisition is an explicitly supplied byte stream.
4. Normalize first<1 to1. Record `multiPage = original last != 0`; last<1 or last>count becomes count. If first>last, return99 before any output mode. This validation also applies to metadata/custom/structure.
5. Select **meta > custom > js > struct > dests > url > ordinary**, independent of flag order. Date precedence is **isodates > rawdates > normal**, in ordinary and custom. Box affects only ordinary. Structure traverses the logical tree; f/l validation does not make it a page-filtered structure walk.
6. Only ordinary resets last=1 when multiPage=false. Consequently `-f 2` passes validation on P3 but emits no size/rotation rows; it does not select page2 geometry. `-l 0` has the same sentinel effect. **Distinct box behavior:** `-f 2 -box` still accesses page2 boxes through the single-page box branch. The ordinary JS presence scan also receives the post-reset range; its exact effects need independent controls.

E: P3 `-f 0` normalizes1; overlarge last clamps; `-f 4` and `-f 2 -l 1` fail99. `-f 2` succeeds and omits size/rotation. Mode-specific empty output, diagnostics and complete outputs remain open where not retained.

## Ordinary output and inventories

S: Info strings are printed only for string objects, including an empty string. Missing/non-string fields are omitted. Order: Title, Subject, Keywords, Author, Creator, Producer, CreationDate, ModDate; then Custom Metadata, Metadata Stream, Tagged, UserProperties, Suspects, Form, JavaScript, Pages, Encrypted, page size/rotation, optional boxes, File size, Optimized, PDF version, optional subtype details.

Exact source prefixes (quoted to preserve significant ASCII spaces; quotes are not output):

```text
"Title:           "
"Subject:         "
"Keywords:        "
"Author:          "
"Creator:         "
"Producer:        "
"CreationDate:    "
"ModDate:         "
"Custom Metadata: "
"Metadata Stream: "
"Tagged:          "
"UserProperties:  "
"Suspects:        "
"Form:            "
"JavaScript:      "
"Pages:           "
"Encrypted:       "
"Page size:       "
"Page rot:        "
"File size:       "
"Optimized:       "
"PDF version:     "
```

Booleans use `yes|no`; Form uses `none|AcroForm|XFA`. Custom Metadata is true on any nonstandard Info key, even if its value would not print in custom mode. Standard keys include Trapped. Metadata Stream indicates optional stream presence, not XML validity. Tagged/UserProperties/Suspects reflect MarkInfo bits; presence of a tree alone does not establish these values. Pages is total count, not selected count. JavaScript presence uses JSInfo rather than byte matching. PDF version uses PDFDoc's interpreted version, not an unqualified header scan; Optimized uses the linearization helper. Subtype requires its document helper and prints optional `PDF subtype:    ` plus indented Title/Abbreviation/Subtitle/Standard/Conformance; exact subtype families need full independent goldens.

Encryption prints `no\n` or `yes (print:VALUE copy:VALUE change:VALUE addNotes:VALUE algorithm:VALUE)\n` after its prefix. Permission queries pass `true` to the four PDFDoc helpers; owner authentication must not silently rewrite stored permission reporting. Algorithms are `RC4|AES|AES-256|unknown`. Inspection is not copy enforcement, decryption bypass or JavaScript execution. E: authorized encrypted controls showed these permission labels and AES-256; passwords/revisions/full summaries remain O.

Geometry uses CropBox width/height and `%g`, rotation `%d`; single-page prefixes above, multipage `Page %4d size:  ` and `Page %4d rot:   `. Letter tolerance is strictly <1 point in either orientation. A0–A6 use the source ISO-216 calculation and strict <0.3%-of-current-height tolerance, swapping orientation allowed. Boundary, negative-zero and C `%g` rounding controls remain O.

Boxes order MediaBox/CropBox/BleedBox/TrimBox/ArtBox; each value `%8.2f`, separated by one ASCII space and ending LF. Single prefixes `MediaBox:        `, `CropBox:         `, `BleedBox:        `, `TrimBox:         `, `ArtBox:          `; multipage `Page %4d MediaBox:  `, `Page %4d CropBox:   `, `Page %4d BleedBox:  `, `Page %4d TrimBox:   `, `Page %4d ArtBox:    `. Inherited values/defaults are parser responsibilities. Failed box-page access emits a diagnostic and continues, without automatically changing final status0.

File size is native's separate filename fopen/seek result, default0. E: stdin P3 reports `File size:       0 bytes\n` despite 1236 input bytes. SDK actual input byte length is a distinct field; never substitute it into CLI-compatible size. Named VFS input must provide explicit size semantics without host fopen.

## Text bytes, raw metadata and custom mode

S: semantic Info text → UCS4 → selected UnicodeMap → sanitize encoded bytes. Dangerous bytes `07 08 0a 0b 0c 0d 0e 0f 1b 7f` become ASCII `?`. TAB/NUL are not in that set. Sanitizing lexical bytes before PDFDocEncoding is wrong: bytes18–1f encode diacritics. Labels/separators/date formatting are native ASCII/C output; `-enc` does not imply re-encoding the entire report. Non-UTF8 map availability/unmappable behavior is O and must be explicitly bounded, never loaded from ambient encoding files.

E: 12 PDF2.0 fixtures × ordinary/custom/meta =36 successful, diagnostic-free invocations. Title cases: ASCII ABC; A+NUL+B; 00–1f+7f; UTF16BE and LE BOM with A/emoji/é; UTF8 BOM café; raw UTF8 café; odd UTF16BE `feff004100`; isolated high/low surrogate followed0041; BOM-only feff; PDFDoc bytes80/81/8d/9f/a0/ad. Observed text preserves embedded NUL, recognizes all three BOM paths, renders raw UTF8 café as `cafÃ©`, drops odd trailing UTF16 byte, replaces isolated surrogates U+FFFD, and prints empty BOM-only title. PDFDoc sequence yields bullet/dagger/left-double-quote/U+FFFD/euro/U+FFFD. Complete stdout and fixture hashes remain O.

UTF8 BOM support occurs earlier in Lexer.cc's literal and hex token paths via utf8ToUtf16WithBom; TextStringToUCS4 alone would miss it. D: retain lexical string bytes and source offsets, then interpret the admitted semantic role. Never normalize ciphertext, signatures or font-code binary strings indiscriminately. Native recovery does not authorize loss of qpdf rewrite bytes.

Custom mode (S): sort raw string keys with std::set; exclude Trapped; print string values only; dates use their special prefixes and date precedence. Keys decode as UTF8, then use output encoding/sanitation. Print colon followed by max(0,16−key UCS4 length) spaces; widths are codepoints, not display cells or encoded-byte count. No ordinary structural summary. Long/non-ASCII/control keys, duplicate names and non-string custom entries require separate goldens.

Meta mode (S): read decoded metadata stream bytes, iterate `c_str()` until first NUL, preserve LF, sanitize the other listed dangerous bytes, append LF when the optional stream exists. Absent stream emits nothing; empty present stream emits LF. `-enc` is admitted but does not semantically decode/re-encode XML here. E: `<root>before` + NUL + remaining XML/control bytes yields exactly `<root>before\n`, status0, no stderr. D: SDK retains complete stream bytes independently and exposes decoded/validated XML separately; lossy CLI serialization must never alter stored metadata or be described as lossless XML extraction.

## Dates

S: parseDateString decodes semantic text, discards non-ASCII characters, uses a C-string view, optionally strips D:, fills missing month/day=1 and time/offset=0, then scans with `%4d%2d%2d%2d%2d%2d%c%2d%*c%2d`. It accepts partial fields; positive year and legacy Distiller recovery differ from strict calendar validation. Overflow, out-of-range calendar fields, trailing junk, non-ASCII deletion and Y2K recovery remain O.

Normal: timegm civil fields, reject time_t−1 to sanitized raw fallback, subtract signed timezone seconds, localtime_r, strftime `%c %Z`. Invalid parsing also falls back to sanitized raw. D: invocation locale/timezone is explicit, never ambient host state. E: `D:20240102030405+05'30'` under UTC renders `Mon Jan  1 21:34:05 2024 UTC`; full date-line golden is not retained.

ISO preserves parsed civil fields and prints `%04d-%02d-%02dT%02d:%02d:%02d`. Zero hour/minute offset prints Z; otherwise sign plus two-digit hours, and colon/minutes only when minutes nonzero. Thus +05 is source-correct for an hour-only offset; forcing +05:00 is incompatible. E: supplied offset date yields `2024-01-02T03:04:05+05:30`; partial D:2024 fills Jan1 midnight. Raw preserves D prefix/quotes after semantic decoding/encoding/sanitation. Isodates wins in both option orders. Exact invalid/date−1 and locale cells remain O.

## Other modes and statuses

Dests (S): merge name-tree destinations before legacy dictionary into maps keyed by page Ref/name; keep only page-reference targets. Name-tree insert wins duplicate same-name/page inserts. Iterate selected pages then sorted names. Header exactly `Page  Destination                 Name\n`; row `%4d `, fixed destination cell, ` "` + encoded/sanitized semantic name + `"\n`. Types XYZ/Fit/FitH/FitV/FitR/FitB/FitBH/FitBV, null coordinates preserved; source sets closing bracket at byte26 and terminator27. Full numeric formatting, duplicate/collision and invalid reference controls remain O.

URL (S): header `Page  Type          URL\n`; selected-page link annotations with URI action only; row `%4d  Annotation    ` + sanitized URI bytes + LF. It does not scan content text or fetch links. `-enc` does not run Info text conversion on URI bytes. Relative/base URI resolution belongs to LinkURI helpers and remains O.

JS (S): JSInfo scans document/page/action/annotation locations and prints source as data. Structure calls printStruct/StructElement helpers, with optional text retrieval, attributes, IDs, references and indentation. Neither executes JS. Exact JS labels and structure/tree/content bytes remain O; these modes require capability gates rather than fake substring inventories.

| Condition | Native status | Evidence |
| --- | ---: | --- |
| Successful mode, including P3 repaired startxref | 0 | E; damaged startxref1 recovered without stderr in this fixture only |
| Wrong password, unreadable/unknown/empty input | 1 | E; exact diagnostics not retained |
| Invalid encoding | 99 | E/S; source message `Couldn't get text encoding`, complete error framing O |
| Invalid page range | 99 | E/S; source message `Wrong page range given: the first page (N) can not be after the last page (M).`, complete framing O |
| Invocation parse/arity error | 99 | S, except explicit help/version0 |
| Help/version/listenc | 0 | S with ordering above; complete bytes O |

Do not import pdftotext's output-open2/copy-denial3 statuses into this read-only utility. Cancellation, unavailable engine and budget failures need explicit first-party policies; no new status is invented by this research task.

## Implementation handoff

Future owner: `packages/safe-bash-command-pdfinfo`, manifest name `safe-bash-command-pdfinfo`, private:true, TypeScript ESM, zero external runtime dependencies. Proposed public route `@poe-platform/safe-bash/commands/pdfinfo`; safe-bash only composes/exports. Do not publish the private command. First-party leaf parser/contracts → command → safe-bash, no return build edge. Follow maintained guarded build, integration boundaries, workspace declarations, bundle and declaration rewriting, package-lint and isolated packed-consumer checks; installed users must not resolve an unpublished workspace. Preserve canonical constructors/byte brands/carrier-context identity through one owning artifact graph.

Before code, validate a gap and add a failing memory-VFS test. CLI and SDK share admitted byte arguments, modes, profiles, fields, serializer/status behavior; raw SDK views are explicitly distinct from CLI compatibility fields. VFS-only streams, explicit signal on acquisition/read/write, sink backpressure, cleanup registered before acquisition and awaited on success/failure/abort. Roll back reservations on every thrown value, including falsey values. No host executable, implicit network, ambient files, native/WASM fallback or dynamic downloads; no JS execution, URI fetching or attachment extraction.

Account before allocation/work for input/output/retained bytes, objects/xrefs/revisions, stream/filter/decoded bytes, graph depth/pages, metadata/text/codepoint and encoding expansion, security rounds/retries, JS/action/destination/structure traversal, sorting and serializer staging. Numeric limits and failure policy belong to accepted engine contracts. Metadata/security/page-tree gates precede command implementation acceptance. Unit tests use memfs/memory VFS and mocked capabilities; native controls stay independent of product and unit tests. Realm ownership, original/checkpoint/replay authority and reservation lifetimes remain mandatory cells.
