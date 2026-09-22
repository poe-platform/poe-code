# pdftotext pinned behavior

Research task: `research-pdftotext`. Recorded 2026-09-21. This is a specification and evidence handoff, not an implementation or a parity claim. Acceptance cells are in [the independent matrix](safe-bash-pdftotext-acceptance.md).

## Current-main inspection

Checkout branch `main`, HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`. `git ls-tree -r --name-only HEAD packages` and working-tree `rg -n pdftotext packages scripts` found no command implementation, tests or export. The existing [pipeline](safe-bash-pdftotext.md) contains research prompts and later implementation tasks. There is no validated current-runtime defect to repair. Unrelated working-tree edits are preserved.

The requested package pattern has been relocated by existing edits to [archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md). Follow that source without restoring the deleted original. No empty workspace or speculative runtime changes are needed for this research task.

## Pin and evidence provenance

Poppler revision **0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46**, version **26.09.90**, a development snapshot, not a stable release. Reported full-source archive SHA256: `e9834d9e5e9269e241d9638e97e32867cdf56140b87af74d0fb9f58a326e158a`.

Supplied executed native controls used macOS, CMake 4.4.3, Freetype 2.14.3, Fontconfig 2.17.1 and JPEG; Qt/GLib/CPP/NSS/GPGME/Brotli/Harfbuzz/curl/OpenJPEG/LCMS/Cairo disabled. Additional branch controls used `LC_ALL=C`, `TZ=UTC`. This qualifies basic original fonts/text/metadata fixtures only. Disabled codecs and signature support are not passes.

Evidence labels throughout:

- **E**: executed observations supplied in the task and existing pipeline. They were not rerun here; original fixture bytes, per-invocation receipts and hashes are not present in this checkout. Descriptions and reported bytes are durable evidence, but cannot substitute for reconstructible full goldens.
- **S**: pinned-source semantics, not an executed acceptance cell.
- **D**: deliberate first-party admission/safety policy; must be documented and tested separately from native equivalence.
- **O**: open qualification; do not invent stdout, stderr or effects.

Fresh inspection fetched the immutable mirror's [utils/pdftotext.cc](https://github.com/tsdgeos/poppler_mirror/blob/0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46/utils/pdftotext.cc), confirming argDesc (110–145), implications/early checks (195–221), listenc (227–230), fixed layout (233–235), EOL/quiet/hyphens (240–267), encoding admission (270–274), PDF-open status and compile-time permissions (288–299). No native executable was built or run in this task. No archive hash was freshly verified.

Other source owners under that same revision:

| Source | Required ownership |
| --- | --- |
| `utils/parseargs.cc` | `parseArgs`, `grabArg`, `isInt`, `isFP`; lexical admission and truncation |
| `utils/pdftotext.cc` | Remaining main, `printDocBBox`, `printWordBBox`, `printTSVBBox`, Info string/date serialization and output effects |
| `poppler/TextOutputDev.cc` | `coalesce`, `dump`, `TextWordList`, physical/logical/raw geometry and ActualText |
| `poppler/Gfx.cc` | Marked-content tag/string checks and scope ownership |
| `poppler/GfxFont.cc` | Adobe names, normalization passes, numeric-name gate, ToUnicode precedence |
| Font/CMap, PDFDoc, xref/filter/crypto owners | Required prerequisites; extraction is not PDF substring scanning |

## Grammar, defaults and admission

Exact spellings: `-f -l -r -x -y -W -H -layout -fixed -raw -remove-hyphens -nodiag -htmlmeta -tsv -enc -listenc -eol -nopgbrk -urls -bbox -bbox-layout -cropbox -colspacing -opw -upw -q -v -h -help --help -?`.

Value operands are separate tokens. No GNU abbreviation, grouped flags or `--key=value`. Recognized options are consumed even after ordinary operands, until `--`; unknown tokens remain positional in native parsing. Repeated values use the last operand. A first-party rejection of unknown-looking tokens is a declared admission deviation: provide deliberate literal-path admission with `--` and do not claim generic getopt compatibility.

Native integer parsing accepts empty/sign-only values; floating parsing also accepts a lone dot, then uses atoi/gatof. Exponent spelling is not admitted by the native lexical grammar. **D:** require complete finite numeric tokens, checked integer ranges and positive DPI; do not enable native degenerate geometry. Separately specify any added exponent grammar rather than assuming it matches native. Defaults: first=1, last=0 sentinel, DPI=72, x/y/W/H=0, fixed=0, colspacing=0.7. Colspacing must be `(0,10]`.

Native CLI password buffers retain 32 bytes; encoding retains 127; EOL/hyphen operands retain 15. These are byte limits, not Unicode character counts. Raw SDK passwords must be explicitly distinguished from the CLI truncation profile; the SDK's CLI-compatible path must have identical semantics. Sentinel, embedded NUL, multibyte truncation and long-value controls remain O.

Input `-` means stdin and requires an explicit output filename. Output `-` means stdout. Otherwise absent output removes exactly final `.pdf` or `.PDF`, then appends `.html` when htmlMeta is active, `.txt` otherwise; mixed `.Pdf` is not stripped. Bbox implications affect this default. **D:** use checked suffix comparison for short filenames; never copy native size-minus-four pointer arithmetic. Named files and stdout are separate effects; native branch-specific fopen modes require independent overwrite/collision/partial-write controls.

Pages: first below 1 clamps to 1; last below 1 or beyond count becomes count; first beyond last fails 99. `-f 4` and `-f 2 -l 1` on the three-page fixture fail 99. `-f 0`, `-l 0`, negative last and overlarge last do not define an empty range.

## Branches and ordering

`bbox-layout ⇒ bbox ⇒ htmlmeta`. Bbox wins over TSV in either option order. HTML metadata plus TSV emits an HTML pre wrapper containing TSV on stdout. Nonzero fixed pitch enables physical layout; raw still wins over physical layout, including `-layout -raw` and `-fixed 6 -raw`. Raw plus TSV has header/page rows only because no flow graph is built.

Colspacing and URLs-with-HTML/TSV validation occur before help/version and quiet installation. `-listenc` succeeds without parsing the document after early argument checks; this does not bypass malformed arity or early validation. Help/version print to stderr and normally return 0, but the early errors retain 99. Invalid EOL prints direct `Bad '-eol' value on command line\n` and continues with platform default even under `-q`. Invalid remove-hyphens returns 99 after quiet installation; quiet suppresses that diagnostic.

`-remove-hyphens none|soft|all` defaults all. It affects logical reading order, not physical/raw blanket replacement. `-nodiag` filters diagonal text; exact threshold/rotation fixtures remain O. URLs are plain-text-only, inert data; exact placement/link annotation controls remain O.

## Bytes and layout

For the supplied UTF8/UNIX three-page control, the exact escaped stdout is:

| Mode | stdout (E), status 0 |
| --- | --- |
| default | `Hello world\nalpha beta\n\n\fhyphenation\n\ncolumn two\n\n\f\f` |
| layout | `Hello world\nalpha beta\n\fhyphen-\nation     column two\n\f\f` |
| raw | `Hello world\nalpha beta\fhyphen-\nation column two\f\f` |

Here `\n` = byte `0a`, `\r` = `0d`, `\f` = `0c`. Default output is 52 bytes. Page formfeed follows **every processed page**, including blank and final pages. `-nopgbrk` removes formfeeds and preserves logical paragraph LFs. EOL unix/dos/mac selects LF/CRLF/CR. Encode spaces, EOL and FF through the admitted output map; do not concatenate UTF8 separators into other encodings. Exact non-UTF8 map availability/listenc bytes and serializer-specific EOL interactions need controls. Product portable default is explicitly UNIX; matching platform-dependent defaults is a separate profile.

S: raw emits EOL when the next baseline delta is at least half the font size and space when horizontal gap exceeds one fifth of font size; no forced final EOL. Physical layout sorts rotated fragments/columns, emits 1–5 EOLs from baseline gaps, and preserves end-line hyphens. Logical flows emit per-line plus per-flow EOL; selected end-line hyphens are suppressed only when a following line/block exists in the same flow. Geometry/font metrics determine words/order; source string sequence is insufficient.

## Crop, coordinates and serializers

`-r` sets DPI. `-x/-y` are top-left slice coordinates, `-W/-H` slice size in pixels; native zero defaults pass through the display slice path. Slices apply only to ordinary text output. `-cropbox` is consulted by bbox/TSV helpers, not ordinary plain displayPages. Exact slice clipping, zero dimensions, rotations, negative coordinates and nonzero box origins remain independent O cells.

Bbox page/block/line/word coordinates use six decimals. TSV word boxes use two decimals, structural boxes six. Page numbers are 1-based; flow/block/line/word indices are 0-based; word confidence=100 and structural confidence=-1. TSV `par_num` precedes `block_num`, unlike Tesseract. Full header and row goldens must be captured independently.

E: at 144 DPI, Hello glyph left=40/top=30.77 while page width=216 PDF points (not 432). CropBox TSV page 2 is 190×120 and glyph origins shift 10,14 points; Hello on page 1 is unchanged. Flat bbox on the blank page prints direct `no word list` stderr but returns 0; bbox-layout empty flow is silent. Exact warning newline/full serialization remains O until recovered. Reported lengths: TSV 1181, bbox 1350, bbox-layout 2257, HTML 496, HTML+TSV 1625, raw+TSV 281 bytes. Lengths alone are not byte goldens.

## Metadata, mappings and ActualText

S: HTML Info helper recognizes only UTF16BE BOM, otherwise PDFDocEncoding; each 16-bit unit is mapped separately. This differs from modern pdfinfo TextString decoding. Preserve odd UTF16/surrogate/NUL recovery controls and do not silently unify decoders. XML escape order is ampersand, apostrophe, quote, less-than, greater-than; links remain inert. Dates preserve parsed civil fields and render a zero-minute offset as `+HH`, not `+HH:00`. Exact malformed metadata/date outputs remain O.

E: 8 original font PDFs × default/raw/layout/bbox = 32 controls. Type1 Helvetica/WinAnsi with one-byte ToUnicode `01→0041`, `02→00660069`, `03→d83dde00` yields `Afi😀\n\n\f`. Odd destination `41` becomes A. A partial map only for 01 leaves 02/03 omitted in that fixture; no universal automatic WinAnsi fallback claim. Explicit FB01/FB02 mappings retain literal ligatures. TJ `[01 -500 02 +500 03]` gives logical `AC B\n\n\f`, raw `A B C\f`; mapped U+0020 need not create a projected visible space. PDF.js normalization/getTextContent is not an independent Poppler oracle.

E: 10 marked-content PDFs × 4 modes = 40 controls, all status 0. Helvetica 12, MediaBox 216×144, ABC at (20,100), optional XYZ at (70,100). `/Span` string ActualText replaces glyphs once at EMC; raw actual is `actual\f`. Default outer replacement is `outer\n\n\f`. Empty span, empty replacement and unclosed span yield only FF. Inner replacement overwrites outer state; outer ABC then inner XYZ yields only inner, while inner ABC then ordinary XYZ yields `inner\n\nXYZ\n\n\f`. Ordinary `/P BMC` nesting preserves outer replacement; `/P` ActualText or numeric Span ActualText leaves ABC unchanged. Extra EMC retains ABC with `Syntax Warning: Mismatched EMC operator` (full diagnostic bytes O).

S: Gfx starts ActualText only for Span/string, including resource property lookup. TextOutputDev owns one optional replacement, not a nested stack: begin overwrites/reset byte count; end emits only with accumulated glyph bytes and clears state. A corrected nested/unclosed/tag policy is a declared deviation. Property resources, form boundaries, clipping, zero-width glyphs and page transitions remain O. Keep glyph bytes, code/CID, mapped Unicode, replacement spans and geometry/provenance separate and bounded.

E: 93 glyph-name controls (31 PDFs × 3 modes) plus 12 variants used Helvetica/WinAnsi, Differences at code 65, content `<41>`, MediaBox 200×100, text at (10,50). Adobe-name pass/presentation-ligature normalization precedes variant/component/uni/u fallback; ToUnicode overrides last. `fi→fi`, `fi.swash`/`uniFB01→ﬁ`; ffi versus ffi.swash similarly differ; `f_f_i→ffi`; `Omega→U+2126`. `A.swash→A`, `A_a→Aa`; empty components ignored; `A_unknown_B→AB` with warning. `uni00410042D8000043→ABC`, `uni0041zzzz0042→AB` without warning; `uniD83DDE00→A` fallback, not emoji. `u1F600→😀`; `u110000/uD800→A`; lowercase hex accepted. Eight-scalar buffer truncates nine chunks to ABCDEFGH. NUL/.notdef produce no glyph text; uniFEFF emits BOM text. No global normalization is equivalent. Mode suffixes reported for these controls: logical LF LF FF, layout LF FF; raw unpositioned lines can emit only FF.

E: 36 numeric-name controls cross start 1/5/6/65 with a65,A4F,65,4F,a65--,a65x,zz65,-1,a4294967295. The heuristic is font-wide: every sequence start must be ≤5 and every name must parse. Start 1/5 maps decimal names to A, hex A4F/4F to O; a65x disables the gate. Start 6/65 disables it. Prefix/trailing-junk parsing and int narrowing are native behavior; -1/overflow can produce LF LF FF with no UTF8 glyph bytes, status 0. **D:** checked code indices, scalar/range/overflow admission and explicit diagnostics; no blind strtol narrowing. Mixed names/multiple starts/negative starts remain O. Glyph-name grammar, ToUnicode UTF16 grammar and metadata decoding are distinct.

## Status and permission profile

| Condition | Native status |
| --- | --- |
| Success, including empty bbox warning | 0 |
| PDF open/password failure | 1 |
| Output open failure | 2 |
| Copy denied, only ENFORCE_PERMISSIONS build | 3 |
| Invocation/range/encoding/hyphen/early validation error | 99 |

Advertised first-party profile decision: **permission enforcing**, matching the supplied alternate `-DENFORCE_PERMISSIONS` utility profile; CLI and SDK must agree. The supplied default native build remains a distinct non-enforcing compatibility control. Valid user password/copy:no extracts successfully there; permission metadata does not prove enforcement. Alternate profile: valid user/copy:no returns 3, empty stdout, `Permission Error: Copying of text from this document is not allowed.\n`; owner succeeds; user with quiet retains 3 and empty stderr; wrong/absent password returns 1. Crypto revisions, password bytes, owner precedence and encrypted fixtures require independently retained goldens before implementation acceptance.

## Implementation handoff

Future ownership: `packages/safe-bash-command-pdftotext`, name `safe-bash-command-pdftotext`, private:true, TypeScript ESM, no external runtime dependencies. Public route is proposed `@poe-platform/safe-bash/commands/pdftotext`; safe-bash only composes/exports. No standalone publication is authorized. Shared PDF engines/contracts are leaf dependencies; no command→safe-bash return edge. Bundle implementation and declarations; installed consumers must never resolve unpublished packages. No proxy-only helpers or default registration expansion.

Use maintained guarded build, integration boundaries, workspace declarations, bundle/declaration rewriting, package-lint and packed-consumer routes. Relevant owners include `packages/safe-bash/scripts/build.mjs`, `integration-boundaries.json`, `scripts/integration-inputs.mjs`, `scripts/build-workspaces.mjs`, `scripts/bundle-safe-bash.mjs`, `scripts/package-safe.mjs`, `scripts/safe-command-publication.mjs`. A manifest with no dependencies alone does not prove the shipped closure is dependency-free.

CLI/SDK share byte argv, engine, statuses, effects and profile decisions. Preserve canonical carrier/context identity, runtime brands, realm ownership and replay lifetime. VFS-only byte I/O; explicit signal on every acquisition/read/write; await sink backpressure. Register idempotent cleanup before acquisition, roll back reservations on all thrown values, close/cancel on success/error/abort. No host executable, ambient file, implicit network, native/WASM fallback, dynamic download, substring extraction or OCR substitute.

Account before allocation/work for input/output/retained bytes, objects/xrefs/revisions, recursion/filter depth and decoded bytes, pages/resources/fonts/CMaps/glyphs/mapping expansions, marked scopes, layout fragments/flows/sorting, crypto rounds/retries and serializer/output staging. Numeric budgets and exact failure policy need engine contracts, not invented constants in this research task. Metadata → text/layout → lossless transformation gates from [the shared PDF plan](safe-bash-pdf-parser.md) remain independent. Tiny Type1 controls do not qualify embedded TrueType/CFF/Type3/CID/vertical fonts.
