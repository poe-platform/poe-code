# csvsort pinned behavior and acceptance matrix

This completes the research-csvsort specification deliverable, not implementation or full compatibility. Independent compatibility expectations live in this document and the historical controls, separately from future engine unit tests. No native executable was run for this task. R means supplied release observation; S means source-derived expectation; G means a pending control. Derived fixtures are specified expectations, not fabricated execution transcripts.

## Current-main inspection and package ownership

Inspected local main `35d01c57f8078d8afa916dc59929395d857e9c55` on 2026-09-20. Tracked package paths and working-tree source/test/manifest searches contain no csvsort implementation, registration, export or unit tests. The local remote-tracking main `557048747a530b3db69af7e03c878ab4989858a5` also has no csvsort package; this is not a fresh remote delivery verification. Absence is concrete repository evidence, not a reproduced runtime bug. Existing research is in [the command plan](safe-bash-csvsort.md#observed-release-controls).

The requested package-pattern file is deleted in unrelated working-tree changes. Its [archived successor](archive/safe-bash-command-package-pattern.md#exact-source-layout-and-import-boundary) and tracked HEAD version were inspected; preserve that move. Research creates no empty command scaffold. Implementation must live in `packages/safe-bash-command-csvsort`, manifest name `safe-bash-command-csvsort`, `private: true`, TypeScript ESM, no external runtime dependencies. Public opt-in API is `@poe-platform/safe-bash/commands/csvsort`. Safe-bash only composes/exports it. Bundle private implementation and declarations into safe-bash; installed consumers cannot require unpublished packages. Do not publish this workspace.

Use canonical private contracts and an acyclic engine/contracts → command → safe-bash graph. Preserve realm-owned brands, argument carrier identity, error constructors, reservation rollback, replay invariants and invocation lifetime. Do not import/extract held XAN sources: `packages/safe-bash/integration-boundaries.json` explicitly holds its CSV/parser/selector/sort modules. Shared CSV/inference engine admission is a prerequisite, not permission to bypass that boundary.

## Pinned oracle and source specification

Source target: csvkit `194c904256a09dc203c460944d35e9d414244503`, agate `34856488cfcbe9077af8e3e557cbf98a044fdd64`. During this task retrieved and inspected [csvsort.py](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/utilities/csvsort.py), [CLI get_column_types](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/cli.py), and [order_by.py](https://github.com/wireservice/agate/blob/34856488cfcbe9077af8e3e557cbf98a044fdd64/agate/table/order_by.py). These source pins are distinct from installed release bytes.

Release evidence supplied by the user: csvkit 2.2.0 / agate 1.14.2 / CPython 3.9.6 / Unicode 13.0.0 / Babel 2.18.0; Decimal precision 28 and ROUND_HALF_EVEN. The 100 csvsort invocations supplement 67 shared CSV controls. Temporal qualification is 87 direct casts + 16 CLI observations + 15 duration grammar cells with parsedatetime 2.6, isodate 0.7.2, pytimeparse 1.1.8. These counts are historical observations, including errors, never product passes. Full raw transcripts of every observation are not supplied; do not claim an exhaustive exact-stderr ledger.

[Temporal source hashes](safe-bash-csvsort.md#temporal-source-authentication) identify development-only oracle files. Authenticate exact distributions and hashes before reruns; no temporal dependency is adopted at runtime. Historical relative controls used local day 2026-09-18 without a frozen clock. CLI LC_ALL=C does not pin timezone or direct-cast locale. Future oracle QA must isolate and record DateTime construction day, parser century clock, timezone and locale separately. Do not reuse historical now-dependent bytes as current expected output.

## Flags and sorting contract

| Flag / interaction | Pinned behavior | Evidence |
| --- | --- | --- |
| -c / --columns | Ordered comma-separated positions, names and ranges; omitted means all columns. Output retains all columns in original order. | S |
| -r / --reverse | Descending lexicographic tuple comparison across all selected keys. Equal full keys retain input order, including reverse. | R/S |
| -i / --ignore-case | Python Unicode 13 str.upper on Text key values only; output retains original Text. Other inferred types unchanged. | R/S |
| -I / --no-inference | Text hypothesis only; null conversion remains. Disables locale/date-format/datetime-format/no-leading-zeroes inference effects, not input parsing. | R/S |
| --blanks | Removes default null spellings from every type; source still appends explicitly supplied --null-value entries. Does not imply -I. | R/S; custom null G |
| --date-format | Python strptime branch, not free-form Date.parse. Date takes precedence over Number for compact numeric dates. | R/S |
| --datetime-format | DateTime precedes Number; distinct from date-format. | S |
| Both format flags | Boolean, TimeDelta, Date, DateTime, Number, Text. With date-format alone: Boolean, TimeDelta, Date, Number, DateTime, Text. | S |
| Neither format, inference enabled | Boolean, Number, TimeDelta, Date, DateTime, Text, whole-column hypothesis elimination. | R/S |
| -u 2 | Input QUOTE_NONNUMERIC: unquoted fields traverse Python float conversion before inference, including headers. | R |
| --out-quoting 2 | Unsupported csvsort flag; argparse status 2, no stdout. Internal shared branch is not CLI admission. | R; exact usage stderr G |
| -n / --names | Names shortcut before missing-input/table/inference/sort; argument parsing still runs first. | S; exact bytes/interactions G |
| -y | Default 1024; 0 disables sniff; -1 whole input. Do not assume Python text sampling equals UTF-8 byte slicing. | R/S; multibyte sampling G |

Type inference examines whole admitted columns, including unselected columns; conversion errors cannot be hidden by selection. Null tokens trim/lower to empty, na, n/a, none, null, dot. Ascending nulls follow nonnulls; reverse nulls precede them. Multi-key comparisons advance to the next key only on equality. Default all-column sorting therefore is not stable on a single-column tie when a later column differs.

Numeric semantics strip percent without division, currency edges, locale grouping (even malformed grouping), and replace locale decimal separators. Default Decimal path never uses JS Number. Sign multiplication rounds under precision 28; preserve scale and signed zero in output. --no-leading-zeroes has native quirks: minus is removed for ASCII-zero checking; +001 bypasses it, -001 stays Text, non-ASCII zero prefixes bypass it. Locale symbol data must be pinned; no ambient ICU localeCompare.

Text compares Unicode code points, not JS UTF-16 units. Ignore-case expansions include ß→SS, ſ→S, ı→I; Kelvin sign stays distinct. Pin Unicode uppercase tables independently of host Unicode/ICU versions.

## Exact fixture matrix

Strings denote UTF-8 bytes without BOM; LF is escaped as `\n`. Unless overridden, argv is `["-y","0","-c","v"]`, stderr is empty, status 0. Expected output includes the displayed final LF. R/S cells reconstruct fixtures from supplied semantics; S cells require independent oracle confirmation before full release parity claims.

| ID | Input | Additional flags | Expected stdout | Evidence |
| --- | --- | --- | --- | --- |
| number | `v\n10\n2\n` | none | `v\n2\n10\n` | R |
| text | same | -I | `v\n10\n2\n` | R |
| boolean | `v,id\n1,a\n0,b\n1,c\n` | none | `v,id\nFalse,b\nTrue,a\nTrue,c\n` | R |
| boolean-reverse | same | -r | `v,id\nTrue,a\nTrue,c\nFalse,b\n` | R |
| nulls | `v,id\nNA,a\n2,b\n.,c\n1,d\nNULL,e\n` | none | `v,id\n1,d\n2,b\n,a\n,c\n,e\n` | R/S |
| nulls-reverse | same | -r | `v,id\n,a\n,c\n,e\n2,b\n1,d\n` | R/S |
| text-null | `v\nNA\nx\n` | -I | `v\nx\n""\n` | R |
| text-blanks | same | -I --blanks | `v\nNA\nx\n` | R |
| exact-large | `v\n9007199254740993\n9007199254740992\n9007199254740994\n` | none | `v\n9007199254740992\n9007199254740993\n9007199254740994\n` | R |
| precision-tie | `v,id\n1234567890123456789012345678901,a\n1234567890123456789012345678900,b\n` | none or -r, separately | `v,id\n1.234567890123456789012345679E+30,a\n1.234567890123456789012345679E+30,b\n` | R/S |
| percent | `v\n10%\n2%\n100%\n` | none | `v\n2\n10\n100\n` | R/S |
| currency | `v\n$10\n€2\n£100\n` | none | `v\n2\n10\n100\n` | R/S |
| grouping | `v\n"1,2,3"\n"12,34"\n` | none | `v\n123\n1234\n` | R/S |
| leading | `v\n001\n02\n10\n` | none | `v\n1\n2\n10\n` | R/S |
| leading-text | same | --no-leading-zeroes | `v\n001\n02\n10\n` | R/S |
| format-date | `v\n20260101\n20250101\n` | --date-format %Y%m%d | `v\n2025-01-01\n2026-01-01\n` | R/S |
| quote-float | `"v","id"\n2,"a"\n1,"b"\n` | -u 2 | `v,id\n1.0,b\n2.0,a\n` | R/S |
| quote-float-tie | `"v","id"\n9007199254740993,"a"\n9007199254740992,"b"\n` | -u 2 | `v,id\n9007199254740992.0,a\n9007199254740992.0,b\n` | R/S |
| multi | `a,b,id\n2,2,p\n2,1,q\n2,1,r\n1,9,s\n` | replace -c v with -c a,b | `a,b,id\n1,9,s\n2,1,q\n2,1,r\n2,2,p\n` | S |
| multi-reverse | same | -c a,b -r | `a,b,id\n2,2,p\n2,1,q\n2,1,r\n1,9,s\n` | S |

Unicode fixture is `v,id\nß,a\nss,b\nſ,c\ns,d\nİ,e\ni,f\nı,g\nK,h\nk,i\n`. Default expected stdout is `v,id\ni,f\nk,i\ns,d\nss,b\nß,a\nİ,e\nı,g\nſ,c\nK,h\n`; -i expected is `v,id\ni,f\nı,g\nk,i\nſ,c\ns,d\nß,a\nss,b\nİ,e\nK,h\n` (R). A separate S control `v\n😀\n\uE000\n` under -I must place U+E000 before U+1F600, exposing UTF-16 comparator substitution.

## Errors, parser and encoding controls

| Control | Expected stdout / status / stderr contract | Evidence |
| --- | --- | --- |
| `a,b\n1,2,3\n`, -y 0 -I, omit -c | empty / 1 / `ValueError: Row 0 has 3 values, but Table only has 2 columns.\n` | R |
| `a,b\n1\n`, same argv | `a,b\n1,\n` / 0 / empty | R |
| `v\nNaN\n2\n1\n` | empty / 1 / Decimal InvalidOperation; exact release diagnostic pending | R/G |
| `v\nInfinity\n-Infinity\n2\n` | `v\n-Infinity\n2\nInfinity\n` / 0 / empty | R/S |
| Mixed aware/naive datetime keys | empty / 1 / TypeError; exact fixture and stderr capture pending | R/G |
| Unquoted header `v` with -u 2 | empty / 1 / float-conversion error; exact stderr pending | R/G |
| `v\n1..5s\n` and `v\n1.2.3h\n`, separately | empty / 1 / ValueError, not Text fallback; exact stderr pending | R/G |
| Duplicate / unnamed headers | Renaming, synthesized names and warnings; exact historical bytes in command plan | R |
| Unknown flag / missing input | empty / 2 / versioned argparse usage + diagnostic; exact invocation profile pending | S/G |

Default input decoding is utf-8-sig; output product policy is UTF-8, comma delimiters, LF, no BOM, explicit byte sink, never host PYTHONIOENCODING. Native stdout encoding must be explicitly fixed to UTF-8 for byte comparisons. Writer replaces each embedded CR with LF before quoting, so embedded CRLF becomes two LF. Qualify single-field empty quoting, commas, embedded quotes, non-ASCII, multiline content and final newline separately.

Shared parser acceptance: -t overrides -d; reader kwargs override sniffed dialect; sniff candidates comma/tab/semicolon/space/colon/pipe; sniff failure warns and uses dialect=None. -K skips physical lines. Headerless names a..z, aa, bb, cc. Numeric selectors are positions even for numeric-looking headers; exact nonnumeric names precede ranges; first duplicate wins; repeated selections preserve order; no whitespace trimming. Open ranges, --zero, boundary errors and duplicate-renaming timing need independent controls. Grep physical line numbering is not a csvsort flag.

Pending versioned profiles must cover Python CSV quoting constants 0..3, malformed/unterminated quotes, escape/doublequote, whitespace, NUL, field size units, invalid encoding/codepages/BOM, empty stream/header-only/all-null/zero-column inputs. Do not substitute RFC4180 strictness or invent behavior from a different Python release. Exact warning stderr includes Python installation paths and source lines; retain raw oracle bytes, then document any deliberate product diagnostic deviation separately rather than silently normalizing it.

## Temporal semantics and deliberate-defect policy

Date free-form parsing uses parsedatetime whole-string matching at year 1 midnight, hasDate and no hasTime. DateTime captures local construction-day midnight, tries parsedatetime then isodate fallback. Explicit Python strptime formats are a different branch and upstream mutates locale. Product must expose invocation clock/timezone/locale/century capabilities, never ambient Date.now/Date.parse or process-wide locale mutation. Unavailable clock-dependent grammar must fail explicitly with a documented deviation, not invented dates.

Typed civil dates, naive datetimes, aware instants with original offsets, and integer-microsecond durations are required. Aware keys compare by instant, retain original offset (Z serializes +00:00), and equal instants stay stable. Millisecond Date is insufficient. Mixed naive/aware comparison errors remain explicit. ISO fractions floor to six digits; timedelta fractional conversion rounds microseconds half-even, so 1.5us and 2.5us both become 2us.

Historical observations: today/tomorrow infer Date year1 Jan1/Jan2; adding yesterday eliminates Date and promotes the whole column to actual-day DateTime. May1 behaves differently in Date and DateTime. Absolute 0001-01-01 can become year2001 before ISO fallback; reinference need not be idempotent. BirthdayEpoch and UTC-century reads are separate dependencies. Fixed-clock future controls must cover leap day, month/year rollovers, century boundaries, DST and construction-time changes; historical reference day alone is not a frozen oracle.

| Duration spelling | Native total seconds / behavior | Acceptance policy |
| --- | --- | --- |
| 1:30 / 1:99 | 90 / 159 | Preserve component normalization; no invented range check |
| 99:99:99 | 4 days, 4:40:39 | Preserve normalized timedelta output |
| PT1H | Text | Do not substitute ISO duration inference |
| 1month | Not duration; can infer Date year1 Feb1 | Qualify whole-column inference, not isolated duration only |
| 0.0001h | 0 | Preserve int(sum) truncation compatibility branch |
| -1.5h2s / -0.1m30s | -5398 / +24 | Preserve observed sign defect in native compatibility profile |
| pipe prefix `|1s` | 1 | Preserve observed accepted sign defect |
| 1..5s / 1.2.3h | ValueError, status1, no output | Preserve error rather than fallback |

No corrected native mode is silently introduced. Any corrected SDK extension must be named separately, documented and equally exposed by CLI, without masquerading as a native flag. Implement an original bounded grammar parser, not a copied unbounded Python regex engine. Pin integer versus fractional paths, normalized negative-day CSV representation, overflow/work limits and microsecond arithmetic. max_precision excludes nonfinite values, normalizes Decimals and caps whole/fraction totals at Decimal context precision; it belongs to shared inference/statistics, not an invented csvsort output option.

## Independent qualification and safety acceptance

All product cells are currently not implemented. Each G cell requires a reviewed fixture, exact argv and input bytes, oracle identity, frozen capabilities where needed, exact stdout/stderr/status and evidence provenance before claiming full compatibility. Native controls are manual QA only; fast unit tests use memory VFS/memfs and mocked capabilities. Expected bytes may not be generated by the engine under test. Original failing tests precede code.

1. Replay exact R fixtures independently; confirm S-derived multi-key, formatting and Unicode controls against the authenticated oracle. Capture missing diagnostics without weakening assertions to substrings.
2. Add temporal grammar, locale symbols/grouping, scientific notation, 29+ digit rounding, nonfinite, scale/negative-zero and mixed-type elimination controls. Include errors in unselected columns and aware instant ties.
3. Run each fixture as one byte chunk, byte-at-a-time and splits inside BOM, multibyte UTF-8, CRLF, escaped quotes and temporal/numeric tokens. Output/status/diagnostics must agree. Copy retained producer fragments before advancing; respect output backpressure.
4. Mock cancellation before acquisition, mid-read, during inference/comparison, and blocked sink writes. Register cleanup before acquisition, close admission, await cooperative tracked cleanup from finally, preserve exact cancellation reason including falsey errors, observe late rejection, forbid new effects after abort, release reservations once. Direct SDK hosts without a cleanup hook still clean up.
5. Bound input/output bytes, fields/records/columns, retained table/copies, inference parses, Unicode expansion, decimal digits/exponent expansion, microseconds, comparison/key work and temporary VFS storage. Test exact limit and one-over-limit, rollback and no partial output for pre-output parse/inference/sort failures. No silent JS Number fallback. Numeric limit defaults belong to the engine task and require measured maintained-budget integration, not arbitrary research constants.
6. Deny ambient files/process/network/native/WASM/downloads. Inject explicit VFS and capabilities. Interleaved invocations with distinct clocks/locales/budgets cannot affect each other or mutate shared globals. SDK and CLI adapters must exercise the same options, results, errors, cancellation and limits.
7. Verify maintained DAG, build/declaration admission and packed installed subpath runtime/types with no private workspace present or bare private specifiers. Preserve canonical brands and constructor identity across root/contracts/command exports; check every advertised platform. No default registration or publication is implied.

No build, unit or screenshot execution is needed for this documentation-only deliverable: there is no runtime or visual CLI change. Implementation, wiring, compatibility QA, packed-consumer evidence and release remain separate open tasks.
