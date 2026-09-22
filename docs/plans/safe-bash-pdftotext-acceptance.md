# pdftotext independent acceptance matrix

Companion to [pinned research](safe-bash-pdftotext-research.md). E/S/D/O labels have the provenance defined there. No implementation cells pass: command, SDK and installed export are absent on inspected main. Native observations supplied by the task are prior evidence, not a fresh local run.

## Original fixture/control inventory

| ID | Fixture and qualification |
| --- | --- |
| P3 | Reported 1236-byte original PDF, three pages; inherited MediaBox 216×144/resources; Helvetica 12; page 1 Hello world/alpha beta, page 2 hyphen-/ation and column two plus CropBox, page 3 empty/Rotate90; Info dates/controlTitle/customOdd |
| P3 variants | Six file profiles plus stdin; unreadable/unknown/empty/wrong-password failures; damaged startxref=1 recovers silently in this fixture only; encrypted permission fixtures require original crypto dictionaries/password bytes |
| F8 | Eight original ToUnicode/ActualText/TJ mapping PDFs, 32 invocations across default/raw/layout/bbox |
| M10 | Ten original marked-content PDFs, 40 invocations across those four modes |
| G31 | Thirty-one original one-glyph Differences PDFs, 93 invocations plus 12 variants; checked regenerated xrefs |
| N36 | Numeric-name starts 1/5/6/65 × nine names; zero-padded sequence starts and matching content byte, regenerated xrefs |
| B34 | Thirty-four P3 branch/parser controls, LC_ALL=C/TZ=UTC |

The reported 326 observations combine **24 pdfinfo and 30 pdftotext cases** over six file profiles plus stdin; do not call all 326 pdftotext tests or infer unlisted cells. Original bytes and per-cell receipts are unavailable locally. Reconstructing a described PDF creates a new fixture and requires fresh oracle capture; equal length is insufficient. Do not extrapolate full outputs from a summary.

## Behavior controls

All plain-text byte predictions below target UTF8, UNIX EOL and explicit stdout destination. `ε` means zero bytes. “Open” means exact bytes/effects were not supplied, even when native semantic status is pinned.

| ID / invocation on P3 unless stated | stdout | stderr | status / evidence |
| --- | --- | --- | --- |
| T01 default | Exact default golden in research, 52 bytes | ε for basic control | 0 E |
| T02 `-layout` | Exact layout golden | ε | 0 E |
| T03 `-raw` | Exact raw golden | ε | 0 E |
| T04 `-nopgbrk` | T01 with every 0c removed, paragraph LF retained | ε | 0 E |
| T05 `-f 3 -l 3` | `\f` | ε | 0 S prediction; isolated capture O |
| T06 `-f 0`; `-l 0`; last beyond count | T01 | ε | 0 E |
| T07 `-f 4`; `-f 2 -l 1` | ε | Exact error open | 99 E |
| T08 `-f 2`; negative last; `-f +2` | Selected normalized pages; full capture open | Full capture open | E controls reported; retain separate cells |
| T09 `-eol unix|dos|mac` | Text EOL mapped to 0a / 0d0a / 0d; FF remains encoded FF | Full capture open | 0 S; full goldens O |
| T10 invalid `-eol`, with/without `-q` | T01 on UNIX native profile | `Bad '-eol' value on command line\n` | 0 E |
| T11 invalid `-remove-hyphens` | ε | Error bytes open; ε with `-q` | 99 E |
| T12 `-remove-hyphens none|soft|all` | Logical-only changes; all=T01 | Exact remaining captures open | S, O beyond supplied default |
| T13 `-layout -raw`; `-fixed 6 -raw` | T03 | ε | 0 E |
| T14 invalid encoding | ε | Full error open | 99 E |
| T15 repeated `-enc` | Last value wins | Full capture open | E/S; particular operands open |
| T16 `-listenc` without document | Encoding list bytes open | Full capture open | 0 S |
| T17 wrong password/unreadable/unknown/empty input | ε | Fixture-specific errors open | 1 E |
| T18 damaged startxref=1 | Expected recovered fixture text | ε | 0 E, no general recovery claim |
| T19 output-open failure | ε | Exact VFS/native comparison open | 2 S |
| T20 `-upw valid`, copy:no, default native build | Expected text | Full capture open | 0 E |
| T21 same, enforcing profile | ε | `Permission Error: Copying of text from this document is not allowed.\n` | 3 E |
| T22 enforcing user + `-q` | ε | ε | 3 E |
| T23 enforcing owner | Expected text | Full capture open | 0 E |
| T24 enforcing wrong/absent password | ε | Exact error open | 1 E |
| T25 `-bbox` | Reported 1350 bytes; full golden open | Blank-page `no word list`, full bytes open | 0 E |
| T26 `-bbox-layout` | Reported 2257 bytes; full golden open | Blank flow silent | 0 E |
| T27 `-tsv` | Reported 1181 bytes; full golden open | Full capture open | 0 E |
| T28 `-bbox -tsv`, reverse order | Same bbox bytes as T25 | Same warning as T25 | 0 E |
| T29 `-htmlmeta` | Reported 496 bytes; full golden open | Full capture open | 0 E |
| T30 HTML+TSV, both orders | HTML pre wrapper and TSV, reported 1625 bytes | Full capture open | 0 E |
| T31 `-raw -tsv` | Header/page rows only, reported 281 bytes | Full capture open | 0 E |
| T32 `-cropbox` plain | Plain path unaffected | Full capture open | E/S |
| T33 `-cropbox -tsv` | Page 2=190×120; origins shift 10,14 | Full capture open | 0 E |
| T34 `-r 144 -tsv` / bbox | Hello left40/top30.77; width216 points | Full capture open | 0 E |
| T35 `-x/-y/-W/-H` plain vs bbox/TSV | Plain slices only | Full capture open | S; executed clipping O |
| T36 invalid colspacing + help/version | ε | Early diagnostic, not suppressed by quiet; exact bytes open | 99 E/S |
| T37 urls + HTML/TSV/bbox | ε | Early diagnostic survives `-q`; exact bytes open | 99 E/S |
| T38 `-r .` | Native degenerate reordered output, bytes open | Full capture open | Native 0 E; product reject D |
| T39 `-r 1e2`; `-r +72` | Separate native lexical controls; bytes open | Full capture open | E reported; do not invent unreported status |
| T40 attached/abbreviated/grouped flags | Unknown tokens are positional, not recognized options | Depends on resulting operands/file | S/E cases reported, full cells O |
| T41 options after input / after `--` | Before delimiter recognized; after delimiter literal | Full capture open | S/E cases reported |
| T42 help/version aliases | ε | Version/copyright/usage bytes open | 0 S, unless early validation fails |

## Positional effects and open qualification

Independent controls must capture stdout **and VFS changes** for input.pdf→input.txt, input.PDF→input.txt, input.Pdf→input.Pdf.txt, short names, bbox/htmlmeta→.html, stdin with omitted destination (99), stdin with named output, stdout `-`, literal unknown-looking filenames after `--`, options after operands, existing output, same input/output identity, branch-specific fopen modes, sink failure and partial-write cleanup. These are S predictions/O effects, not verified named-output equivalence. No host filename or external encoding/font configuration may leak into product behavior.

Retain separate full mapping goldens for F8/M10/G31/N36 using the explicit semantic examples in research. For every output mode record all stdout bytes, full stderr and status; do not assume raw/layout/bbox from a logical example. Add malformed ToUnicode surrogate/odd/NUL controls, explicit mapping precedence, multiple Differences starts/mixed numeric names, ActualText resource properties/forms/clipping/page transitions, metadata UTF16/unit decoding and dates. Embedded TrueType/CFF/Type3/CID/vertical fonts, CMaps, widths/rotation/columns/diagonal filtering and links remain open profile gates.

## Separation and execution protocol

Keep independent native-control assets/receipts separate from implementation unit tests. Each receipt records source revision/archive hash, utility build profile and permission macro, libraries, locale/timezone, encoding maps/assets, fixture SHA256, exact argv bytes, input transport, stdout/stderr hex or byte artifacts, status and named-output before/after hashes. Record unavailable cells as unavailable, never success. Research native tooling is an oracle only and never a runtime fallback.

When implementation is authorized, first add a failing unit test for each feature/validated repair in the responsible package using memfs or memory VFS and mocked capabilities. Unit tests must not write host fixtures, call native binaries, query an LLM or import an upstream oracle. Native expected bytes are independently captured data, never generated by the implementation under test. Keep strict admission tests separate from compatibility controls so deliberate deviations cannot silently turn into native parity assertions.

Required product controls: equivalent CLI/SDK results; byte-argv ownership and carrier identity; cancellation before/during read/decode/layout/write; cleanup on every exit/thrown value; backpressure; quota boundary/over-budget cases; unsupported features diagnosed rather than approximated; canonical realm/runtime identities and replay invariants. No test timeout increases, weakened assertions or unavailable profiles counted as passes.

Packaging acceptance requires maintained build/lint/unit closure plus installed public tarball runtime and strict NodeNext declaration consumers outside the checkout. Verify opt-in `@poe-platform/safe-bash/commands/pdftotext`, bundled private implementation/declarations, no unpublished package/specifier resolution and no external runtime closure. Run CLI screenshots if later code changes affect visual output; screenshots are ad hoc evidence, not unit tests. Research-only docs require link/content and whitespace checks, not runtime test claims.

## Delivery state

Research/specification recorded; implementation, full reconstructible native goldens, named-output effects, installed consumer qualification and broad font/layout parity remain pending. This task changes documentation only. No local commit, verified remote-main delivery, release or private publication is claimed.
