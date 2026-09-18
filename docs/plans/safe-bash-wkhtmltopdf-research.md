# wkhtmltopdf pinned semantics and acceptance specification

Research task: `research-wkhtmltopdf`. Audited on 2026-09-18 against local `main` at `052940a62255aa620236474575b4003a2df76549`. Working tree was clean. Inspection found no `packages/safe-bash-command-wkhtmltopdf`, no wkhtmltopdf references in safe-bash source/tests/build scripts, and no public command export. The existing [command plan](safe-bash-wkhtmltopdf.md) contains source findings and a 122-switch declaration inventory. This document makes those findings acceptance requirements; it does not implement or qualify a renderer.

## Evidence and qualification

Pin upstream source to [`024b2b2bb459dd904d15b911d04c6df4ff2c9031`](https://github.com/wkhtmltopdf/wkhtmltopdf/tree/024b2b2bb459dd904d15b911d04c6df4ff2c9031), committed 2022-06-29. Its `VERSION` file says `0.12.7-dev`; the commit message's download release `0.12.6.1-2` is not this tree's compiled version. GitHub reports the repository archived; the commit date is not evidence of the archive date. A source revision is not a native binary version: `common.pri` permits `WKHTMLTOX_VERSION` to override `VERSION`. No executable was run, downloaded, or admitted as a product dependency.

All native expectations below are source-derived hypotheses unless explicitly described as unresolved. Before asserting compatibility, record binary version output and SHA256, distribution/build revision, full Qt/WebKit revision and patch set, `__EXTENSIVE_WKHTMLTOPDF_QT_HACK__`, platform, fonts and their licenses/hashes, codecs, locale, timezone, clock, DPI and resource bytes. Unpatched Qt is a separate profile: its printing branch uses only object zero. Unsupported-switch warnings occur after handlers execute and cannot establish that a setting has no effect. `--use-xserver` is Unix-conditional and inherits the patched-Qt registration mark.

These source files were fetched directly at the pinned revision and SHA256 checked in memory. No generated evidence or scratch files remain.

| File under `src/` | SHA256 |
| --- | --- |
| pdf/pdfarguments.cc | `af84e7a7230a7cb2ab063d3e8f9ba0514517fcf6ab08997f90e7ac6f6bbad92b` |
| shared/commonarguments.cc | `1b8d221f5ba1acb8287ff670593210167aae8f38c7e8fd8a70b3b169ca3085ea` |
| shared/commandlineparserbase.cc | `be27a5f24f64a74d748bbd210899f3ae2bcea910a3a66ca0aa20a53d9852c4bb` |
| pdf/pdfcommandlineparser.cc | `ca6dfa80f463cde7468ee949069cdf11b9e58992da6e0d1d1b8b6602de625b52` |
| pdf/wkhtmltopdf.cc | `ca2fdb8e7811a8d48745004bcbd92d66b152f4d2d7f1f5e82932edf12775a720` |
| lib/pdfsettings.cc | `40c034efc542c860a3b21b435b324e01bb10726854765d0323f13052f2057a27` |
| lib/loadsettings.cc | `2cde8747e1c701d5c093c58ca234a485b846f8ef32cabaff7b9b8c51cfed7576` |
| lib/websettings.cc | `837582ea9fe2e08d1d237ebfa202a6d2e642418dbf610b09dd2a8059a2df2406` |
| lib/multipageloader.cc | `1ff79639e9b9c66008874ffa8e72d7c4fc1df4d7cec10dcb55a6415deccecd45` |
| lib/pdfconverter.cc | `aeb2ea1578a2915047eefd36abc687aad91d0f027ceeda22ca9b4b89e5da4f18` |
| lib/outline.cc | `969b07e9ae4be570d4ec3b5d92f2c8202fc8cb711bc340b412eab72731469342` |
| lib/utilities.cc | `03f80686544398bff67c78c0ac357170097c18419eed822e0b7085d4c4ceca63` |

Dimension source control: wkhtmltopdf/qt [`baf062653cf41412cadbeecfb8ffd992ab9025c9`, src/gui/painting/qprinter.cpp:90](https://github.com/wkhtmltopdf/qt/blob/baf062653cf41412cadbeecfb8ffd992ab9025c9/src/gui/painting/qprinter.cpp#L90) contains `{210, 297}, // A4` in its millimeter table. File SHA256 is `f010b2c1eab0e8724c992ae5fb90af65d92b96e8cf4d022e1146d28562fe70fd`. This independently pins the nominal dimension source, not the Qt revision linked into any as-yet-unqualified binary.

## Ownership and admission contract

Follow [the package pattern](safe-bash-command-package-pattern.md): implementation belongs in private TypeScript ESM workspace `safe-bash-command-wkhtmltopdf` at `packages/safe-bash-command-wkhtmltopdf`, with no external runtime dependencies. Do not add empty scaffolding for research. The future API is `@poe-platform/safe-bash/commands/wkhtmltopdf`, with opt-in registration; safe-bash only composes and exports. Bundle implementation and declarations through maintained build/packaging policy. Packed consumers must resolve with the private workspace absent, preserving canonical argument/value brands, error identity, realm ownership, allocation accounting and replay invariants. No dependency edge may return from the command to safe-bash. Do not publish the private package.

CLI and SDK use the same parser/settings/engine and byte streams. CLI argument bytes have an explicit encoding policy; Unicode SDK strings are a separate input domain. Native `QString::fromLocal8Bit`, `toInt`, and binary32 `toFloat` need boundary controls; finite checked numeric validation is an explicit safety deviation, not an inferred Qt equivalence. Repeated cookies, headers, posts, allow entries and replacements preserve ordered entries and duplicate keys. A JS object map is insufficient.

VFS is the only file domain. No executable, ambient file, implicit network, native/WASM fallback, or dynamic download. Resource capabilities admit identities and bounded bytes, not host path strings. Network and JavaScript are independent, explicit capabilities, disabled by default; markup, base URLs, event handlers and flags cannot grant either. Static JavaScript disablement deliberately differs from native enablement. Dynamic execution flags require a separately approved safe harness profile or fail before conversion. Plugins and X-server behavior remain excluded. No blanket TLS error bypass.

Every invocation owns its stage, resources, reservations, readers and writers. Bound input/object count, argument/decoded bytes, DOM nodes/depth, CSS rules/selectors/matches, layout/reflow work, pagination/TOC iterations, font/shaping work, image pixels/decoded bytes, PDF objects/output bytes and deadline. Check cancellation inside each incremental loop and around capability calls. Success, parse/load/layout failure, cancellation, budget exhaustion and sink failure release ownership exactly once. No asynchronous work or resources survive disposal. Never publish a partially constructed PDF file; stdout sink failure can leave delivered bytes and must be reported as such. Define collision/alias policy before reading source and staging output.

## Pinned settings and interactions

| Concern | Native source contract | Required control |
| --- | --- | --- |
| Paper | `Size::Size` selects `QPrinter::A4`; Portrait, DPI 96. The independent Qt table above pins 210 × 297 mm | Exact Qt PDF rounding remains unqualified. Compare both orientations and named sizes with the binary's pinned Qt dimension table. |
| Custom paper | Both width and height must differ from sentinel -1; otherwise named size wins. `setPaperSize(QSizeF(width,height), height.unit)` | Width-only, height-only, named-size ordering and mixed width/height units. Do not silently normalize the native cross-unit behavior. |
| Margins | L/R 10 mm; T/B -1 auto, then 10 mm without measured HTML headers/footers. Patched printer uses maximum reserve across objects | Measured HTML reserve plus spacing, explicit reserve and mixed objects. All four parsed Qt units must match, not all suffixes: cm/m normalize to mm. |
| Distances | Case-insensitive empty/mm/millimeter, cm/centimeter, m/meter, didot, in/inch, pc/pica, cicero, px/pixel, pt/point | Pin lexical scanner (digits, optional dot, digits), aliases and Qt conversions. Sign/exponent/whitespace are not generic JS numeric syntax. px means device pixel here. |
| Layout scaling | WebKit CSS pixels at 96, device factor DPI/96, zoom and intelligent shrinking | Width overflow, viewport, zoom binary32, minimum font size and DPI interactions. CSS px is not PDF pt. |
| Output | Copies 1, collate true, color, compression true, image DPI 600 and quality 94; outline true/depth 4 | Copies/quality/grayscale/compression/title interact with the PDF writer; compare decoded semantics rather than raw PDF bytes. |
| Web | Background/images/JS/smart shrinking true; plugins false; minimum font -1; encoding empty | Native empty encoding delegates to Qt/WebKit detection. Product must specify supported labels, BOM/meta/option precedence and malformed-byte policy before enabling encoding claims. |
| Loading | Delay 200 ms, zoom 1, local blocked, slow scripts stopped, page error abort/media ignore; screen media | Separate screen/print cascade controls. Native status polling every 50 ms can be indefinite; product deadline/work bounds replace this. |
| Headers/footers | Arial 12, spacing 0, no text/line/HTML initially | Left/center/right, line toggles, font assets, HTML measurement and ordered `--replace`. Built-ins overwrite colliding custom keys; explicit clock/locale replaces ambient date/time. |
| TOC | Dots, title `Table of Contents`, indentation 1em, binary32 scale 0.8; forward links true/back false | Native Qt XSLT 2.0 is not a generic template language. Pin supported XSLT separately; reject entity/URL/file access and unsupported constructs. |

Leading global/page flags populate defaults cloned per object. Parse `page INPUT`, `cover INPUT` and `toc` followed by their scoped flags; the final argv element is output. Global-only flags after an object fail. Cover cleanup occurs after scoped flags and removes header/footer text, lines and HTML plus outline inclusion; it does not disable `pagesCount`. TOC and page scopes remain distinct.

Long flags match exact names, so `--orientation=Landscape` is unknown. Grouped short flags consume separate following operands; do not infer attached operands. The parser checks ASCII `'0'` at byte two, so `--0...` enables default mode and bare `--` is unknown in source. Native qualification is required before imitating that defect; standard `--` support would be an explicit deviation.

Batch stdin uses a custom per-line tokenizer: no shell expansion; backslash escapes one character even inside single quotes; empty quoted words disappear; unmatched quotes are accepted. Each line appends tokens to original argv, creates fresh settings, and stops at the first failed conversion. Native batch status is 0/1, unlike single-job HTTP mapping. Pin interaction between argument stdin and document stdin before admitting both.

Physical PDF pages, logical counted pages and outline prefix sums are separate. `pagesCount=false` zeroes logical count but still prints actual pages. `spoolTo` advances numbering only for counted objects. Collated copies repeat the document and reset numbering; uncollated copies repeat each physical page before advancing. Outline empty placeholders count one page, then replacement uses actual printer page count even for uncounted objects. Header `topage`, TOC destinations and output page count must not share an assumed counter. `pagesCount` is a settings-level concern, not a new invented CLI switch.

TOC reloads until page count and outline stabilize. No native iteration bound was found; enforce convergence/work budgets and cancellation with a distinct diagnostic. Headings h1–h9 sort by rendered (page,y,x); coordinate collisions overwrite in QMap. Empty/unplaced headings disappear; LF becomes space and text is trimmed. Skipped levels attach under the preceding lower level. Section caches retain the first heading of each level on a page and carry forward. Suspected anchor reuse defect stays an independent control, not a speculative repair.

Links resolve against frame base URL. Known input documents use body or fragment lookup in order `a[name]`, any `[id]`, any `[name]`; missing fragments are omitted. Other destinations are external when enabled, resolved or original according to relative-link settings. Reserved `__WKANCHOR_` handling, percent encoding, duplicate inputs, selector characters and hit geometry require controls. Forms/links in PDF cannot execute scripts or submit requests in the renderer.

## HTML/CSS profile and incremental gates

No profile is currently implemented. The intended first-party static profile is distinct from pinned legacy WebKit behavior and from modern browser standards. Each gate requires a published admission list for elements/properties/units/selectors/encodings and explicit failures for unsupported features; silently dropping layout-affecting constructs does not pass. Earlier passing gates do not close later tasks.

| Gate | Intended admitted profile | Evidence required before claim |
| --- | --- | --- |
| G0 | Parser/settings, object cloning, byte decoding and capability denial | Memory-VFS parser tests; all switch dispositions; no rendering claim |
| G1 | HTML5 tree construction/entities, paragraphs/headings/spans/br, lists; CSS type/class/id selectors, cascade/specificity/inheritance, inline style, bounded px/pt/mm/em/%; normal-flow blocks/inline boxes | Independent malformed HTML/cascade fixtures, licensed explicit fonts, shaping/line breaks, PDF geometry/text and screenshots |
| G2 | Saved images/font faces and VFS stylesheet imports, relative/base URLs; screen/print media; backgrounds, borders, padding, margins and box sizing | Asset identity and MIME/codec/encoding controls; missing/denied resources; resolution/cycle/decode/pixel limits; zero implicit fetches |
| G3 | Tables with repeated headers, floats, positioned boxes, overflow and legacy page-break behavior | Long tables and split rows, orphan/widow policy, blank pages, deterministic pagination and shrink/zoom/DPI screenshots |
| G4 | Text/HTML headers and footers, separate page counters, ordered objects/copies, outlines, inert links/forms, bounded convergent TOC | W07/W12–W15 controls, outline XML/model and annotation destinations/rectangles, XSLT admission profile |
| G5 | Browser-quality documents within a declared complete static profile | Qualified native legacy corpus plus separately pinned modern browser screenshots; typography, assets and pagination tolerances published per fixture |

Flex/grid, modern selectors/media features and other modern CSS are not assumed supported by the archived renderer or by G1–G4. They require separately specified extension gates. Existing Pandoc conversion has external dependencies and simplified layout; it is not a substitute for HTML5/cascade/font/shaping/paged-layout/PDF engines. Audit code and asset licensing before adaptation.

## Independent fixtures and observable results

Fixture definitions below are exact UTF-8 bytes without a trailing newline unless stated. Future unit fixtures materialize these in memory VFS. Native QA uses licensed saved copies in a deliberately controlled offline environment; no product runtime spawns the oracle. These definitions are independent compatibility controls, not implementation-produced golden values.

| ID | VFS path and exact bytes | Purpose |
| --- | --- | --- |
| F1 | `/docs/a.html`: `<!doctype html><meta charset="utf-8"><title>A</title><h1 id="a">Alpha</h1><p>Hello</p>` | Basic text/title/outline/body target |
| F2 | `/docs/b.html`: `<!doctype html><h2 id="b">Beta</h2><p style="page-break-before:always">Second</p>` | Forced break, skipped heading level, multi-input/copies |
| F3 | `/docs/media.html`: `<!doctype html><style>p:before{content:"screen"}@media print{p:before{content:"print"}}</style><p>Body</p>` | Screen versus print media |
| F4 | `/docs/links.html`: `<!doctype html><base href="vfs:/docs/"><a href="a.html#a">hit</a><a href="a.html#absent">miss</a><a href="https://example.invalid/x">external</a>` | Offline base, local/external annotations; no request |
| F5 | `/docs/header.html`: `<!doctype html><p style="height:20mm">Header</p>` | HTML header reserve/spacing/cover clearing |
| F6 | `/docs/dynamic.html`: `<!doctype html><script>window.status="ready"</script><img src="https://example.invalid/x">` | Independent JS and network denials, no implicit grants |
| F7 | `/docs/encoding.html`: hex `3c703ec3a93c2f703e` (`<p>é</p>`) | UTF-8 option/meta/BOM variations; add exact alternate codec bytes when codec profile is qualified |

For conversions below use quiet logging and offline F1–F7 resources. Success with file output means stdout empty bytes, status 0, a valid PDF in the output VFS; success with output `-` means PDF stdout beginning `%PDF-`, status 0 and no diagnostics for a clean fixture. Quiet progress suppression does not suppress loader warnings. PDF bytes/page coordinates and full native progress/usage stderr remain unrecorded until native qualification: do not invent a byte-for-byte golden result or an arbitrary visual tolerance.

| Control | argv after executable / condition | Source-derived expected observable |
| --- | --- | --- |
| C01 | `--quiet /docs/a.html out.pdf` | Default A4/Portrait target; Alpha/Hello text, title A, outline Alpha; file-success contract |
| C02 | `--quiet --orientation Landscape --page-size A4 /docs/a.html -` | Landscape paper and stdout-success contract; physical dimensions/rounding require Qt control |
| C03 | `--quiet --page-width 100mm --page-height 200mm /docs/a.html out.pdf` | Custom QSizeF 100,200 in mm; compare width-only/height-only falling back to A4 and mixed-unit interpretation |
| C04 | All margins `1cm`, with left changed to `10mm` | Same parsed Qt unit, no mixed-unit failure; geometry nominally equivalent |
| C05 | Left `1in`, other margins `10mm` | Conversion fails: diagnostic contains `Currently all margin units must be the same!`; unknown-error terminal line, status 1. Native partial file/stdout effects require capture |
| C06 | `--quiet /docs/media.html out.pdf` versus leading `--print-media-type` | Screen versus print generated label, separate from background/image toggles |
| C07 | Leading `--header-html /docs/header.html --header-spacing 2`, then `cover /docs/a.html /docs/b.html out.pdf` | Cover header cleared even if reapplied in its scoped options; later page inherits defaults; compare auto/explicit margins and maximum reserve |
| C08 | Leading `--header-center [page]/[topage] --copies 2`, F1 then F2 | Collated document order versus `--no-collate` per-page repeats; distinct physical/logical/outline counts and `--page-offset` |
| C09 | `--quiet toc /docs/a.html /docs/b.html out.pdf` | Generated TOC fixed point, forward links and heading hierarchy under patched Qt; page count unknown until qualified |
| C10 | F4 with internal/external/relative switches toggled independently | Existing local target included, absent known-document fragment omitted, external annotation inert; no network access for link text |
| C11 | F6 with no capabilities, then each capability separately | Product static default never executes script/fetches. Execution flags fail without harness; network grant cannot grant JS and vice versa |
| C12 | `--orientation=Landscape /docs/a.html out.pdf` | stdout empty; status 1; stderr starts `Unknown long argument --orientation=Landscape\n\n`, followed by usage |
| C13 | `/docs/a.html --copies 2 out.pdf` | stdout empty; status 1; stderr starts `--copies specified in incorrect location\n\n`, followed by usage |
| C14 | `--copies nope /docs/a.html out.pdf` | stdout empty; status 1; stderr starts `Invalid argument(s) parsed to --copies\n\n`, followed by usage |
| C15 | `--copies` (no other arguments) | stdout empty; status 1; stderr starts `Not enough arguments parsed to --copies\n\n`, followed by usage |
| C16 | `-- /docs/a.html out.pdf` versus `--0 /docs/a.html out.pdf` | Bare `--` unknown prefix/status 1 in source; ASCII-zero default-mode quirk awaits native control |
| C17 | Batch lines containing `''`, `'a\\ b'`, unmatched quotes, `$HOME`, `*.html` | Tokenizer semantics above; literal expansion characters, per-line fresh settings, stop first failure/status 1. Capture prior successful output effects separately |
| C18 | Same/aliased source and destination, cancellation during layout/TOC/output, failing sink | Product bounded stage/cleanup contract; no file publication on failure, all reservations/readers released; delivered stdout bytes cannot be recalled |

`utilities.cc:140–179` pins terminal stderr and status independently of layout. These are exact terminal lines, not a claim that preceding loader stderr is absent. Nonzero error code wins even when converter success is true. HTTP results do not grant a network capability; use mocked capability responses for product unit tests and controlled native QA resources for oracle captures.

| success / errorCode | Terminal stderr bytes | Status |
| --- | --- | ---: |
| true / 0 | empty | 0 |
| false / 0 | `Exit with code 1, due to unknown error.\n` | 1 |
| either / 404 | `Exit with code 2 due to http error: 404 Page not found\n` | 2 |
| either / 401 | `Exit with code 3 due to http error: 401 Unauthorized\n` | 3 |
| either / 403 | `Exit with code 1 due to http error: 403 Forbidden\n` | 1 |
| either / other HTTP | `Exit with code 1 due to http error: N MESSAGE\n`; unknown message is empty, retaining the space | 1 |
| either / 1000 + Qt enum | `Exit with code 1 due to network error: SYMBOL\n`; symbol depends on pinned Qt enum | 1 |
| batch conversion success/failure | Helper above bypassed; retain actual conversion diagnostics, no synthesized helper line | 0 / 1 |

## Acceptance accounting and remaining work

Retain W01–W22 from the existing plan as independent controls: patch profile, scopes, parser quirks, batch, streams, units, margins, scaling, media/encoding, CSS layout, legacy limits, header keys, counters/copies, TOC/links, forms, load errors, resource identity, script isolation, credentials/network, PDF quality, publication collisions and budgets/cleanup. The switch matrix below is exhaustive admission accounting; every row is currently unimplemented. A target disposition is not supported behavior.

Implementation tests must be fast memory-VFS tests with mocked capabilities, added failing first for each validated behavior. They establish implementation correctness, not native compatibility. Independent QA records candidate revision, fixture bytes/hashes, exact argv, capability profile, status, stdout/stderr bytes, VFS effects and screenshot/PDF inspection. Inspect page geometry/text/annotation/outline/form semantics separately from rasterized screenshots. Pin rasterizer/browser/fonts and tolerances before visual comparisons; performance is a separate result.

Open evidence: native binary/Qt qualification, exact dimension/numeric/codec boundaries, full usage/progress/warning transcripts, native failed-conversion output effects, physical pagination/outline/TOC controls, visual corpus and XSLT profile. Product diagnostic wording/status for unsupported features, cancellation and budgets must be frozen during parser/engine work; no runtime exists from which to report them now. Research establishes the contract and controls; engine, integration and compatibility tasks remain open.

## Complete switch disposition matrix

Scope/arity/Qt mark are retained from the pinned declaration inventory. `static` means intended bounded first-party implementation, `resource` requires supplied VFS/capability resources, `harness` requires separately admitted execution (otherwise reject), and `excluded` must reject explicitly. Every row has current state **not implemented**. Metadata/help commands describe the admitted product profile rather than falsely reporting a native WebKit binary.
| Switch | Short | Scope | Arity | Qt mark | Target disposition |
| --- | --- | --- | ---: | --- | --- |
| --help | h | global | 0 | false | static |
| --version | V | global | 0 | false | static |
| --license |  | global | 0 | false | static |
| --extended-help | H | global | 0 | false | static |
| --manpage |  | global | 0 | false | static |
| --htmldoc |  | global | 0 | false | static |
| --readme |  | global | 0 | false | static |
| --quiet | q | global | 0 | false | static |
| --log-level |  | global | 1 | false | static |
| --no-collate |  | global | 0 | false | static |
| --collate |  | global | 0 | false | static |
| --copies |  | global | 1 | false | static |
| --orientation | O | global | 1 | false | static |
| --page-size | s | global | 1 | false | static |
| --grayscale | g | global | 0 | false | static |
| --lowquality | l | global | 0 | false | static |
| --title |  | global | 1 | false | static |
| --read-args-from-stdin |  | global | 0 | false | static |
| --margin-bottom | B | global | 1 | false | static |
| --margin-left | L | global | 1 | false | static |
| --margin-right | R | global | 1 | false | static |
| --margin-top | T | global | 1 | false | static |
| --dpi | d | global | 1 | false | static |
| --page-height |  | global | 1 | false | static |
| --page-width |  | global | 1 | false | static |
| --cookie-jar |  | global | 1 | false | resource |
| --image-quality |  | global | 1 | true | static |
| --image-dpi |  | global | 1 | true | static |
| --no-pdf-compression |  | global | 0 | true | static |
| --use-xserver |  | global | 0 | true | excluded |
| --outline |  | global | 0 | true | static |
| --no-outline |  | global | 0 | true | static |
| --outline-depth |  | global | 1 | true | static |
| --dump-outline |  | global | 1 | true | resource |
| --dump-default-toc-xsl |  | global | 0 | true | static |
| --default-header |  | page | 0 | true | static |
| --viewport-size |  | page | 1 | true | static |
| --enable-plugins |  | page | 0 | false | excluded |
| --disable-plugins |  | page | 0 | false | static |
| --minimum-font-size |  | page | 1 | false | static |
| --user-style-sheet |  | page | 1 | false | resource |
| --no-images |  | page | 0 | false | static |
| --images |  | page | 0 | false | static |
| --disable-javascript | n | page | 0 | false | static |
| --enable-javascript |  | page | 0 | false | harness |
| --encoding |  | page | 1 | false | static |
| --no-background |  | page | 0 | false | static |
| --background |  | page | 0 | false | static |
| --include-in-outline |  | page | 0 | true | static |
| --exclude-from-outline |  | page | 0 | true | static |
| --disable-smart-shrinking |  | page | 0 | true | static |
| --enable-smart-shrinking |  | page | 0 | true | static |
| --print-media-type |  | page | 0 | true | static |
| --no-print-media-type |  | page | 0 | true | static |
| --enable-forms |  | page | 0 | true | static |
| --disable-forms |  | page | 0 | true | static |
| --disable-internal-links |  | page | 0 | true | static |
| --enable-internal-links |  | page | 0 | true | static |
| --disable-external-links |  | page | 0 | true | static |
| --enable-external-links |  | page | 0 | true | static |
| --resolve-relative-links |  | page | 0 | true | static |
| --keep-relative-links |  | page | 0 | true | static |
| --enable-toc-back-links |  | page | 0 | true | static |
| --disable-toc-back-links |  | page | 0 | true | static |
| --proxy | p | page | 1 | false | resource |
| --proxy-hostname-lookup |  | page | 0 | false | resource |
| --bypass-proxy-for |  | page | 1 | false | resource |
| --username |  | page | 1 | false | resource |
| --password |  | page | 1 | false | resource |
| --ssl-key-path |  | page | 1 | false | resource |
| --ssl-key-password |  | page | 1 | false | resource |
| --ssl-crt-path |  | page | 1 | false | resource |
| --load-error-handling |  | page | 1 | false | static |
| --load-media-error-handling |  | page | 1 | false | static |
| --custom-header |  | page | 2 | false | resource |
| --custom-header-propagation |  | page | 0 | false | resource |
| --no-custom-header-propagation |  | page | 0 | false | resource |
| --javascript-delay |  | page | 1 | false | harness |
| --window-status |  | page | 1 | false | harness |
| --zoom |  | page | 1 | false | static |
| --cookie |  | page | 2 | false | resource |
| --post |  | page | 2 | false | resource |
| --post-file |  | page | 2 | false | resource |
| --disable-local-file-access |  | page | 0 | false | static |
| --enable-local-file-access |  | page | 0 | false | resource |
| --allow |  | page | 1 | false | resource |
| --cache-dir |  | page | 1 | false | resource |
| --debug-javascript |  | page | 0 | false | harness |
| --no-debug-javascript |  | page | 0 | false | harness |
| --stop-slow-scripts |  | page | 0 | false | harness |
| --no-stop-slow-scripts |  | page | 0 | false | harness |
| --run-script |  | page | 1 | false | harness |
| --checkbox-svg |  | page | 1 | false | resource |
| --checkbox-checked-svg |  | page | 1 | false | resource |
| --radiobutton-svg |  | page | 1 | false | resource |
| --radiobutton-checked-svg |  | page | 1 | false | resource |
| --page-offset |  | page | 1 | false | static |
| --footer-center |  | page | 1 | true | static |
| --footer-font-name |  | page | 1 | true | static |
| --footer-font-size |  | page | 1 | true | static |
| --footer-left |  | page | 1 | true | static |
| --footer-line |  | page | 0 | true | static |
| --no-footer-line |  | page | 0 | true | static |
| --footer-right |  | page | 1 | true | static |
| --footer-spacing |  | page | 1 | true | static |
| --footer-html |  | page | 1 | true | resource |
| --header-center |  | page | 1 | true | static |
| --header-font-name |  | page | 1 | true | static |
| --header-font-size |  | page | 1 | true | static |
| --header-left |  | page | 1 | true | static |
| --header-line |  | page | 0 | true | static |
| --no-header-line |  | page | 0 | true | static |
| --header-right |  | page | 1 | true | static |
| --header-spacing |  | page | 1 | true | static |
| --header-html |  | page | 1 | true | resource |
| --replace |  | page | 2 | true | static |
| --xsl-style-sheet |  | toc | 1 | true | resource |
| --toc-header-text |  | toc | 1 | true | static |
| --disable-toc-links |  | toc | 0 | true | static |
| --disable-dotted-lines |  | toc | 0 | true | static |
| --toc-text-size-shrink |  | toc | 1 | true | static |
| --toc-level-indentation |  | toc | 1 | true | static |
