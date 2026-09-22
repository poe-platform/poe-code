# Tesseract behavior and acceptance matrix

Research task `research-tesseract`, 2026-09-20. This document specifies future
acceptance; it does not advertise an implemented OCR command. Independent native
controls and their evidence limits live in [compatibility-tesseract.md](compatibility-tesseract.md).

## Current-main inspection and scope

Inspected local `main` at `ab1fa8d34` plus the existing working tree. Both
`git ls-tree -r --name-only HEAD packages` and current package/source/test/export
searches found no Tesseract command implementation, tests, or export. The existing
`safe-bash-tesseract.md` separates research, engine, behavior and delivery tasks.
Absence validates an implementation prerequisite, not a repairable OCR defect.
No runtime changes or empty package scaffolding are justified by this research.
Remote main and releases were not inspected or qualified.

The requested package-pattern path was already deleted with a corresponding
working-tree document at [archive/safe-bash-command-package-pattern.md](archive/safe-bash-command-package-pattern.md).
That document was inspected without restoring the deleted file. Its ownership,
canonical contracts, private artifact and installed-consumer gates apply.

Future owner: `packages/safe-bash-command-tesseract`, manifest name
`safe-bash-command-tesseract`, `private: true`, TypeScript ESM, no external runtime
dependencies. Safe Bash only composes and exports
`@poe-platform/safe-bash/commands/tesseract`; proposed factory
`createTesseractCommand(options): CommandDefinition` imports canonical leaf
contracts, never Safe Bash. No default registration or standalone publication.
The runtime and declaration closure must be bundled/copied into the public
artifact with canonical identity preserved. An unpublished workspace must never
be required by an installed consumer. This route is proposed, currently absent.

## Specification pin and source ownership

Authoritative source is [Tesseract commit 8ae68101439b3f7df123499a784e8896c805179d](https://github.com/tesseract-ocr/tesseract/tree/8ae68101439b3f7df123499a784e8896c805179d),
reporting 5.5.3. Archive SHA256:
`32896866e05e72c2c4e29cb4b1e195873880e8f400fcc2ec637f01913a0897c0`.
Source license: Apache-2.0. The supplied native research build uses Release,
FAST_FLOAT ON; native optimization, OpenMP, training, tests, graphics, curl,
archive and TIFF OFF; codec/zlib-free Leptonica 1.86.0. These build restrictions
are oracle qualifications, never permission to narrow product support silently.

| Source owner | Contract |
| --- | --- |
| `src/tesseract.cpp`: ParseArgs, stringToPSM/OEM, FixPageSegMode, PreloadRenderers, main1 | Argument grammar, defaults, configuration precedence, renderer selection, statuses |
| `src/api/baseapi.cpp`: ProcessPagesInternal/FileList/MultipageTiff, GetUTF8Text/TSVText/BoxText | Input dispatch, page sequencing, text/layout/confidence and coordinate contracts |
| `src/api/{renderer,hocrrenderer,pdfrenderer}.cpp` | Output framing, escaping, identifiers, searchable PDF |
| `src/ccmain/{thresholder,pagesegmain,linerec,osdetect}.cpp` | Pixel normalization, segmentation, crops, orientation/script detection |
| `src/lstm/lstmrecognizer.cpp`: Load/DeSerialize/RecognizeLine; network, weightmatrix, recodebeam | Serialized model, tensor math, CTC recoding and dictionary beam search |
| `src/ccutil/{tessdatamanager,serialis}.cpp` | Traineddata component table and bounded binary framing |

This task freshly read pinned `tesseract.cpp` to confirm grammar, symbolic maps,
PSM precedence, layout-only statuses and renderer selection. Other source findings
and the 93 native controls are supplied research evidence, not newly executed
controls. Source inspection and native controls have separate evidentiary roles.

## Arguments and interactions

| Surface | Pinned native behavior | Product acceptance requirement |
| --- | --- | --- |
| Input | Image, image-list, `stdin` or `-`; format detection can fall back to image-list, including binary-NUL truncation | VFS-only bytes; reject URL input without fetching; reject unknown binary input and NUL-containing lists explicitly; no ambient discovery |
| Output base | `stdout` or `-` shares stdout; named base appends renderer extension, including `out.txt.txt` | Byte-stream stdout or admitted VFS destinations; preflight destination aliases/collisions |
| Ordering | Immediately after image, next argv is outputbase even if option-like; after outputbase, first non-option begins config names and stops normal option parsing | Preserve grammar in CLI and SDK argv dispatch; typed options must produce the same admitted invocation |
| `-l` | Native default `eng`; language selection can load multiple models | Ordered `+`-separated admitted IDs; every requested model explicitly provided; no default asset acquisition or silent substitution; qualify multilingual ordering separately |
| `--psm` | Exact numeric strings 0–13 or symbols below; CLI default 3, API default 6 | Shared CLI/SDK command default 3; mode acceptance requires independent engine evidence |
| Config PSM | After Init, FixPageSegMode applies CLI mode only when loaded mode is 6; other config values win, even over explicit CLI | Preserve and test the mode-6 exception; distinguish parsed CLI mode from effective engine mode |
| `--oem` | 0–3 or symbols below; default 3, or 1 with legacy disabled; model contents constrain availability | Explicit declared engine/model capability; reject unsupported legacy/combined modes, never pretend LSTM implements them |
| `-c` | Split first `=`; preserve remaining value; missing `=` throws, caught as status 1; unknown variable warns and may succeed | Bounded key/value parsing; explicit supported-variable registry and unsupported-config error (documented deviation); no arbitrary host debug paths |
| `--dpi` | `atoi`: `abc` becomes 0 and `12tail` becomes 12; nonzero sets user_defined_dpi | Proposed strict ASCII decimal integer 70–2400; reject suffixes/signs/overflow/out-of-range before engine work; documented safety deviation, pending engine qualification |
| Config names | Missing config warns but may succeed; names set renderer variables | Explicit admitted config bytes/known renderer names; unavailable config is an error, not ambient tessdata search |
| stdin | Native buffers whole stream for seekable detection | Account bounded in-memory input/spool before decoding; cancellation during every read |
| Side effects | Training, debug images/PDF, zone files, user dictionaries can access paths | Only separately supplied VFS capabilities; no implicit sibling zone/model/config reads |

PSM aliases, case-sensitive and exact:

| Numeric | Symbol | Meaning / qualification |
| --- | --- | --- |
| 0 | `osd_only` | Orientation/script only; requires legacy OSD resources |
| 1 | `auto_osd` | Automatic segmentation with OSD |
| 2 | `auto_only` | AnalyseLayout, orientation stderr, no OCR |
| 3 | `auto` | Automatic segmentation without OSD |
| 4 | `single_column` | Single column, variable sizes |
| 5 | `single_block_vert_text` | Vertical block |
| 6 | `single_block` | Uniform block |
| 7 | `single_line` | Single line |
| 8 | `single_word` | Single word |
| 9 | `circle_word` | Word in circle |
| 10 | `single_char` | Single character |
| 11 | `sparse_text` | Sparse text |
| 12 | `sparse_text_osd` | Sparse text with OSD |
| 13 | `raw_line` | Raw line |

OEM aliases: `0=tesseract_only`, `1=lstm_only`,
`2=tesseract_lstm_combined`, `3=default`. Exact mapped strings are accepted;
permissive numeric-prefix conversion applies to DPI, not these maps. Legacy-disabled
builds reject PSM 0 and warn/remap 1→3 and 12→11. Those remaps must not be
misreported as successful OSD. Explicit non-OSD language with mode 0 may produce
an orientation-only warning; an LSTM-only English model does not qualify OSD.

General native parse/init/process failure is 1 and success 0; no-input/help/version
return 0. `--list-langs` returns 0 even when initialization fails. PSM 2 image-read
failure returns 2; a blank page can return 1. Product limits, cancellation,
unsupported capability and partial output need distinct structured SDK errors
mapped to nonzero CLI status, with no suppression of causes or yielded prefixes.
No timeout promise comes from a guessed `-c` variable.

## Renderer contracts and acceptance

| Renderer | Required output contract | Gate state |
| --- | --- | --- |
| txt | UTF-8 paragraph-iterator text, excluding image/line blocks; separator before subsequent image only, default FF; named `.txt` | Native HELLO and three-page controls supplied; first-party recognition/output unimplemented |
| tsv | One fixed 12-column header: `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n`; levels 1–5; page numbers 1-based, top-origin geometry, nonword conf -1, word decimal confidence | Enumerated bitmap coordinates supplied; full hierarchy/escaping/error bytes still need sealed controls |
| hocr | `.hocr`; native HTML/XHTML framing, escaping, page/block/paragraph/line/word IDs, bbox and confidence fields; distinct from PAGE/ALTO | Source-derived; exact full-byte fixture control pending |
| pdf | `.pdf`; raster image plus invisible glyphless-font text with ToUnicode, correct page/glyph placement; `textonly_pdf` separate profile | Native oracle failed after partial output without zlib; searchable PDF remains unqualified |

Plain text is selected explicitly or as fallback when no other renderer was
created and no renderer creation error occurred. `tessedit_create_txt=0` alone
still falls back to txt. Creation errors can leave some native renderers active;
product must report partial-output failure explicitly. Native txt+tsv stdout
emits TSV then txt regardless of config request order. Initial product acceptance
profile permits one renderer on stdout, multiple formats only to distinct named
VFS destinations; rejecting shared multi-format stdout is an explicit deviation.
Preflight all list paths and destinations before committing named outputs where
atomicity is promised. Streaming stdout may retain a prefix on later failure.

Image lists and multipage TIFF use one output per selected renderer, not one file
per page. TIFF and image codecs require separate qualification; disabled TIFF in
the oracle cannot establish them. Box output is outside the requested shipping
formats but is a geometry control: zero-based pages, bottom-origin coordinates,
unlike TSV. hOCR, PAGE, ALTO and PDF must not reuse one generic escaping contract.

Direct PDF input is not native image support. A future scanned-PDF workflow must
be named a product extension and use separately qualified first-party
rasterization. Parser text extraction is not OCR. Native URL fetch through
optional libcurl is intentionally denied in the product.

## Script, language and model acceptance matrix

Every cell below remains unavailable in the product. No language-wide accuracy
claim follows from one English bitmap control.

| Profile | Explicit assets needed | Independent acceptance corpus / modes |
| --- | --- | --- |
| Latin / `eng` | Approved English LSTM traineddata, unicharset/recoder/dictionaries | Printed prose, punctuation, digits, accents, multiple columns; modes 3/4/6/7/11/13 |
| Latin multilingual | Each ordered language model and dictionaries | Mixed lines and language-order permutations; no fallback to English |
| Cyrillic / Greek | Separately pinned language assets | Similar-looking glyphs, mixed Latin and target script |
| Arabic / Hebrew | Separately pinned RTL assets | Joining, diacritics, bidi order and confidence/layout geometry |
| Devanagari | Separately pinned language assets | Headline/script splitting, ligatures and combining marks |
| CJK horizontal / vertical | Separately pinned language/orientation assets | Fixed-pitch ordering, mixed Latin, mode 5 vertical controls |
| OSD | Separately pinned legacy classifier/`osd` model | Four rotations, weak orientation, low sample counts, script confusion; modes 0/1/12 |
| Legacy / combined OEM | Legacy components and an independently qualified engine | OEM 0/2 outputs; LSTM-only model is an expected rejection |
| Handwriting / degraded scans | Explicit model profile trained/admitted for the domain | Dedicated held-out corpus; printed-text acceptance cannot authorize these claims |

The research-only English model is
[tessdata_fast 87416418657359cb625c412a48b6e1d6d41c29bd](https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd),
`eng.traineddata`, **4,113,088 bytes**, SHA256
`7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.
This task freshly fetched those bytes in memory and verified size/hash. The
same pinned LICENSE is 11,358 bytes, SHA256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`,
Apache-2.0. No model was installed, retained or adopted as a shipping asset.
Other script/model source pins, sizes and notices are **not admitted**; family
membership never establishes their provenance or license.

Provisioning must be explicit: caller supplies model byte streams or authorized
VFS identities with a reviewed manifest containing source URL/commit, exact byte
length/hash, license and retained notices, language/script, traineddata components,
quantized/float profile, supported modes and engine revision. Verify limits and
identity before parsing/allocating; never inherit TESSDATA_PREFIX, ambient models,
cookies or credentials. A missing model is a provisioning error. No network,
automatic downloads, native/WASM or external inference fallback.

Proposed accuracy gates are requirements, **not measured results**: exact HELLO
and blank controls (CER/WER 0); per admitted printed-text language/script cell,
held-out corpus of at least 100 independently sourced pages and 10,000 reference
characters, CER ≤1%, WER ≤5%, and at most +0.25 percentage points CER / +1 point
WER against the pinned native model/profile on the same corpus. Score decoded
Unicode code points with Levenshtein distance; no whitespace/case/diacritic
normalization beyond reference line-ending CRLF→LF. Freeze corpus bytes, licenses,
reference transcript/order and scoring policy before candidate execution;
report per domain/script/mode, not only pooled results. Empty-page hallucination
rate must be 0 in the frozen blank set. Layout boxes require exact fixture
coordinates and coordinate-system checks; confidence follows native conversion,
not raw neural scores. Thresholds require review and independent engine evidence
before advertising support. No corpus currently meets these admission gates.

## Safety, implementation and installed-delivery gates

First-party JS traineddata/network loader, tensor operations, thresholding,
deskew/segmentation, CTC recoder/beam/dictionary and image codecs are prerequisites.
A synthetic tiny classifier or greedy argmax cannot close mature OCR fidelity.
Pin float32/quantized rounding and scalar/SIMD oracle profile separately.

Resource options must cover input/list/config/model bytes, decoded dimensions and
pixels, pages, tensor elements/retained bytes, dictionary nodes/traversal, beam
candidates, algorithm steps, recursion and output bytes. Use checked arithmetic,
reserve before allocations/copies, rollback on all thrown values, and bounded
cancellation checkpoints in reading, parsing, preprocessing, inference and output.
Numeric production budgets remain pending measured engine admission; native
permissive allocation maxima are not defaults. Cleanup releases invocation-owned
streams, VFS handles, buffers/reservations and temporary outputs on success,
failure and cancellation, without disposing shared caller capabilities.

TDD applies to subsequent code: original failing tests in memory VFS/memfs and
mocked capabilities must precede repairs/features. Preserve byte argv ownership,
carrier/args pairing, canonical errors/realm identity and replay invariants.
CLI must dispatch the same SDK command and expose equivalent capability/limit
options. Unit tests must never execute/fetch a native oracle or use host files.

Installed-artifact controls must import the public subpath and strict NodeNext
declarations, register/run actual Shell-created byte argv, compare canonical
identity across imports, verify VFS/pipes/cancellation/cleanup and deny ambient
host/network access. Inspect packed JS/declarations for bare private imports and
the entire command runtime/asset closure for external dependencies. Browser,
workerd and other runtime profiles need independent execution evidence. No package,
model, export or release capability is admitted by this document alone.

## Verification receipt

Current-main absence searches and fresh pinned argument-source/model-license
checks completed. The research and independent-control documents were reviewed
for required pins, modes, output/error qualifications and provisioning gates.
No code changed, so no implementation tests or screenshots were appropriate.
Full-byte hOCR/PDF and several native diagnostic controls remain pending as
identified in the independent-control document. No local commit, remote delivery,
release or private publication was performed.
