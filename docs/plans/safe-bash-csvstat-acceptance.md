# csvstat research specification and acceptance matrix

This document closes the **research-csvstat specification task**, not command implementation or full compatibility. Independent controls belong here; implementation tests must consume independently reviewed expectations rather than manufacture them with the implementation. Native executables are manual development QA only. No native command was executed for this document.

## Repository inspection and ownership

Inspected local `main` at `35d01c57f8078d8afa916dc59929395d857e9c55` on 2026-09-20. `git ls-tree -r --name-only HEAD packages` contains no csvstat/csvsort implementation. Searches of safe-bash sources, tests, manifest and bundle script found no csvstat registration, tests or export. Existing behavior controls are in [the command plan](safe-bash-csvstat.md#observed-release-controls). Missing implementation is concrete repository evidence, not a reproduced runtime defect. No speculative runtime repair is authorized by this research task.

The requested package-pattern path is locally deleted by unrelated work; its available successor is [the archived pattern](archive/safe-bash-command-package-pattern.md). Preserve both changes. Future ownership is:

- `packages/safe-bash-command-csvstat`, manifest name `safe-bash-command-csvstat`, `private: true`, TypeScript ESM, no external runtime dependencies.
- Public opt-in API `@poe-platform/safe-bash/commands/csvstat`; safe-bash composes/exports, never owns statistics logic. No empty package scaffold is added by research.
- Bundle implementation and declarations into the safe-bash artifact; packed consumers must resolve without private workspace installation or leaked private specifiers. Use maintained build, declaration and publication checks, preserve canonical contract/argument/value identity and avoid command-to-safe-bash cycles.
- Byte streams, memory/VFS-only I/O, explicit invocation cancellation/cleanup and resource accounting. No ambient files, host executable, implicit network, native/WASM fallback, dynamic download or external temporal runtime. CLI invokes the same SDK behavior. Clock/timezone/locale are explicit capabilities, not process globals.

## Oracle identity and evidence boundaries

Source specification: [csvstat.py](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/utilities/csvstat.py), [shared CLI](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/cli.py), csvkit commit `194c904256a09dc203c460944d35e9d414244503`; agate commit `34856488cfcbe9077af8e3e557cbf98a044fdd64`. The pinned csvstat source was retrieved and inspected during this task, including argument validation, count, aggregation exception handling and all serializers. Source snapshots are not assumed identical to release distributions.

User-supplied executed release evidence: csvkit 2.2.0, agate 1.14.2, CPython 3.9.6, Unicode 13.0.0, Babel 2.18.0, Decimal precision 28 / ROUND_HALF_EVEN, CLI `LC_ALL=C`. Statistics evidence comprises 87 invocations (12 fixtures × six profiles plus 15 interactions), distinct from 100 csvsort inference observations and earlier 67 shared CSV controls. The supplied summary is evidence of those observations; it does not provide 87 raw transcripts, so this document does not invent an exhaustive byte ledger or claim a new rerun.

Temporal dependency identities: parsedatetime 2.6, isodate 0.7.2, pytimeparse 1.1.8. Exact installed-source hashes and historical clock limitations remain in [the command plan](safe-bash-csvstat.md#temporal-source-authentication). Reauthenticate exact distributions/files before oracle reruns. Historical reference day 2026-09-18 was not a frozen clock; do not replay time-sensitive outputs as current exact expectations. LC_ALL=C does not establish timezone or direct-cast locale guarantees. Never inherit host PYTHONIOENCODING into product behavior.

Evidence labels below: **R** = supplied release observation; **S** = pinned-source derivation, not newly executed; **G** = pending independent admission control. All implementation cells currently remain not implemented. No native-dependent unit tests.

## Flag and output contract

Operations, in output order: `type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq`. CLI spellings are `--non-nulls` and `--max-precision`. `--nulls` is a Boolean has-null indicator, not a null count. `--non-nulls` counts non-null values; `--count` counts logical CSV records minus the header, bypassing selection and inference.

Source validation order: argparse → names-only shortcut → missing-input check → multiple-operation check → operation/CSV conflict → operation/JSON conflict → operation/count conflict → count shortcut → parsing/inference → selectors → aggregation/output. Names-only interactions therefore require controls independently of operation validation. Count still decodes/parses CSV and skips physical lines; bypassing inference is not bypassing grammar or decoding errors.

| Interaction | Expected outcome | Evidence |
| --- | --- | --- |
| Two different operation flags | stdout empty, status 2; only-one-operation error | R/S |
| Operation plus --csv / --json / --count | stdout empty, status 2; respective conflict error | S |
| --csv --json, no operation | CSV wins; JSON flag still influences numeric formatting path in source | R/S |
| --count --json or --csv | count line only; selectors/inference unused | R/S |
| --freq-count 0 | default five; zero is ignored | R/S |
| --freq-count negative | empty frequency list, success | R/S |
| One selected column, one operation | unlabeled value plus LF | R/S |
| Multiple/repeated selections, one operation | one line per selection: `%3i. %s: %s\n`, original 1-based id | S |
| -I | inference disabled; numeric/date operations become unavailable where type-inappropriate | S; exact bytes G |
| -n plus conflicting operations/count | names shortcut precedes semantic conflict checks | S; exact bytes G |

Argument conflict stderr is the exact versioned argparse usage block followed by one of these lines, with final LF. The complete release usage block and two-operation control are preserved in [existing exact controls](safe-bash-csvstat.md#observed-release-controls); do not replace byte comparison with substring matching when claiming native parity.

```text
csvstat: error: Only one operation argument may be specified (--mean, --median, etc).
csvstat: error: You may not specify --csv and an operation (--mean, --median, etc) at the same time.
csvstat: error: You may not specify --json and an operation (--mean, --median, etc) at the same time.
csvstat: error: You may not specify --count and an operation (--mean, --median, etc) at the same time.
```

Repeated identical operation switches set one Boolean and are not two distinct operations (S). Format/selector argument parsing can still fail before shortcuts. Unknown flags remain status 2; internal get_column_types branches do not authorize invented native flags.

## Fixtures and single-operation acceptance

Escaped strings below define exact decoded fixtures; encode UTF-8 without BOM unless a cell overrides it. Each operation is a separate invocation `csvstat -y 0 -c v <operation>`, not combined flags. Unless noted, expected stderr is empty and status 0; each displayed scalar is stdout followed by `\n`. R/S marks a source-derived exact expectation supported by the supplied qualification, rather than a new byte capture.

| ID | Input bytes expressed as string | Evidence |
| --- | --- | --- |
| N | `"v\n2\n4\n6\n"` | R |
| ONE | `"v\n2\n"` | R |
| MIX | `"v\n2\nNA\n4\n.\n"` | S (explicit control fixture) |
| NULL | `"v\nNA\nNULL\n.\n"` | R |
| HEAD | `"v\n"` | R |
| BOOL | `"v\n1\n0\n1\n"` | R |
| TEXT | `"v\nx\ny\nx\ny\nz\n"` | R |
| UNI | `"v\n😀\nÁ\nﬀ\n"` (A + U+0301) | R |
| BIG | `"v\n9007199254740993\n9007199254740992\n"` | R |
| NAN | `"v\nNaN\n2\n1\n"` | R |
| INF | `"v\nInfinity\n-Infinity\n2\n"` | R |
| HUNDRED | `"v\n100\n200\n"` | R |

| Fixture | type | --non-nulls | --unique | --min | --max | --sum | --mean | --median | --stdev | --len |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N | Number | 3 | 3 | 2 | 6 | 12 | 4 | 4 | 2 | None |
| ONE | Number | 1 | 1 | 2 | 2 | 2 | 2 | 2 | None | None |
| MIX | Number | 2 | 3 | 2 | 4 | 6 | 3 | 3 | 1.414 | None |
| NULL | Boolean | 0 | 1 | None | None | None | None | None | None | None |
| HEAD | Boolean | 0 | 0 | None | None | None | None | None | None | None |
| BOOL | Boolean | 3 | 2 | None | None | None | None | None | None | None |
| TEXT | Text | 5 | 3 | None | None | None | None | None | None | 1 |
| UNI | Text | 3 | 3 | None | None | None | None | None | None | 2 |

Table cells are S-derived controls; R explicitly confirms singleton unavailable deviation, null/header-only types, Unicode length and relevant base-profile outcomes. `--nulls` returns `True\n` for MIX/NULL and `False\n` for N/ONE/HEAD/BOOL/TEXT/UNI (S). Empty byte stream is a separate fixture, not HEAD: `--count` gives `-1\n`, `--count -H` gives `0\n` (R). Header-only count is `0\n` (S). `"v\n\"x\ny\"\n"` count is `1\n` (R). MIX row count is 4, non-null count 2, unique count 3.

Arithmetic excludes nulls. Deviation is **sample**, sqrt(sum((x-mean)^2)/(n-1)), not population: N gives 2, whereas population would be sqrt(8/3). Median uses agate's CDF percentile-50 algorithm; independently qualify even-sized, repeated, null-containing and large-Decimal cases. All-null/empty inferred Boolean cannot be treated as an empty Number column with sum zero. Explicitly typed empty Number is an SDK extension requiring separate controls.

Exact frequency controls (S unless identified R): TEXT → `{ "x": 2, "y": 2, "z": 1 }\n`; NULL → `{ "None": 3 }\n`; HEAD → `{  }\n`; BOOL → `{ "True": 2, "False": 1 }\n`. Ties follow first occurrence; unique and frequency include null. TEXT limit -1 gives `{  }\n` (R), limit 0 gives the default-five result (R/S). Add six distinct values to distinguish default five from unlimited (G). Single-operation frequency stringification is not escaped JSON; quotes/newlines in values require independent byte controls.

## Serialization and unavailable statistics

Full text omits unavailable operation lines, prints column blocks and a final `Row count: N\n`; single unavailable operation prints `None\n`. JSON omits unavailable keys. CSV has fixed columns and leaves unavailable cells blank, without removing columns. Use the existing exact singleton JSON, CSV and output-precedence controls as independent byte goldens, including Boolean capitalization, final LF and key order.

CSV header is exactly:

```text
column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq
```

CSV frequency contains comma-space-separated values without counts (null becomes `None`), then CSV quoting. JSON frequency is an array of objects with ordered keys `value,count`; numeric Decimal values convert to Python float. Compact JSON uses Python spacing (`: ` and `, `), preserves non-ASCII, float `.0` spellings and has **no final LF**. Indent zero/negative creates line structure without indentation; exact fixtures remain G. `--zero` affects selection offsets, not reported 1-based column ids (S).

BIG retains exact values internally (unique 2 and distinct frequencies), but JSON min/max/frequency values collapse to `9007199254740992.0`; stdev is `0.7071067811865476` (R). Never compute statistics on already-rounded JSON floats. UNI JSON len is `2.0` (R), while scalar/CSV len is formatted `2`. Text min/max are unavailable; do not introduce lexical extrema.

NAN JSON omits min/max/median and emits bare `NaN` for sum/mean/stdev/frequency (R). INF JSON has -Infinity/Infinity extrema/frequencies and omits failed sum/mean/stdev (R). Product policy for this intended compatibility profile: use an explicit bounded native-compatible serializer, including non-RFC8259 nonfinite tokens; expose typed values in SDK and do not route through JSON.stringify. Strict JSON, if offered later, is a separately named SDK/profile extension with explicit rejection diagnostics; it cannot claim native byte parity. Full nonfinite byte goldens and frequency order still require capture (G).

Default finite numeric display is invocation-locale `%.3f`, grouping enabled unless -G, then unconditional trailing `0` removal and trailing `.` removal. It is a separate float/locale formatting path, not exact Decimal serialization. HUNDRED with `--decimal-format %.0f`: sum stdout `3\n`, mean `15\n`, stdev `71\n` (R). Literal `nonsense` with --sum prints `nonsense\n`; `%Q` with --sum prints `None\n` (R). JSON ignores decimal-format (R); CSV+JSON still uses the source JSON flag to skip finite Decimal formatting (S), needing fractional-value controls. Preserve these quirks for the admitted native profile; corrected formatting must be a documented separate deviation. Tie rounding, negative zero, grouping locales and float conversion overflow remain G; C locale alone proves no non-C grouping behavior.

Upstream suppresses NullCalculationWarning and catches ordinary aggregation exceptions. Product must distinguish legitimate unavailable results from cancellation, quota and internal failures. Those failures must propagate through the canonical invocation failure contract, never become `None`, omitted keys or success. Exact product error messages/status must be fixed with TDD when the command contract is implemented; research does not fabricate existing error bytes.

## Selection and shared reader qualification

Add independent controls before parser/inference integration; these are not universal CSV parity claims.

| Control | Fixture / invocation | Pinned rule / remaining evidence |
| --- | --- | --- |
| SEL-position | `"2,v\n2,4\n"`, -c 2 --sum | numeric selector means position, stdout `4\n` (S) |
| SEL-repeat | `"a,b\n2,4\n"`, -c b,a,b --sum | stdout `"  2. b: 4\n  1. a: 2\n  2. b: 4\n"` (S) |
| SEL-name-range | header includes `a-b`, -c a-b | exact nonnumeric name before range expansion; bytes G |
| SEL-duplicate | duplicate header names | first duplicate wins; capture agate header renaming/selection interaction G |
| SEL-space | -c `" v"` / `"v "` | no whitespace trimming; error transcript G |
| SEL-boundary | 0, -1, missing names, out-of-range, 1-, -2, --zero | independent closed/open-range and error controls G |
| HEADERLESS | 29 fields, -H -n | a..z, aa, bb, cc; exact output G |
| DIALECT | conflicting -t/-d; comma/tab/semicolon/space/colon/pipe | -t wins; explicit reader kwargs override sniffed fields; output CSV comma/LF |
| SNIFF | failure, -y0, -y-1, bounded samples | warning then dialect=None on failure; exact warning/profile G |
| SKIP | -K with quoted multiline data | physical lines skipped; --count remains logical-record count |
| CR | quoted CR and CRLF in names/text | writer converts each CR to LF; CRLF becomes two LF before quoting |
| ENCODING | BOM, split UTF-8, invalid bytes, unknown codec | default utf-8-sig; versioned decode/error profiles G |
| QUOTING | -u0/1/2/3, -b, -p, malformed quotes, NUL | CPython 3.9-specific profile, not substituted RFC4180 strictness |

QUOTE_NONNUMERIC is a distinct compatibility float input path: unquoted header errors before inference; unquoted big integers can collapse through Python float. Default Decimal parsing must stay exact within context, not silently use JS Number. Inputs 1/0/1 infer Boolean; mixed nulls do not automatically force Text. Whole-column hypotheses eliminate preferred types across admitted rows. Pin numeric locale symbols, percentages/currency/group-removal quirks, Unicode digits, leading-zero flags, context rounding/scale/negative zero and max_precision (normalized finite Decimals capped at total context precision). Share csvsort inference only after its independent scope admission; no XAN source extraction/import without held-source gates.

Temporal controls require civil dates, microsecond datetime/duration values and explicit invocation clock/timezone/locale/century. Date uses year-1 ZERO_DT; DateTime has construction-day and parser-century clock reads. Whole-string matches and date/time predicates precede ISO fallback; custom strptime precedence is separate. Relative today/tomorrow/yesterday, leap/month/year boundaries, low years and awareness mixtures remain clock-qualified controls. Equal aware instants collapse unique/frequency by instant while retaining the first representative offset; lexical strings/object identity are insufficient. ISO fractions floor to six microseconds; timedelta fractions round half-even. pytimeparse admits 1:99, rejects ISO PT1H as duration, truncates fractional nonsecond components and has documented sign/pipe/multiple-dot defects. Preserve the supplied temporal controls and source hashes from the main plan; statistics-specific CLI transcripts are still G. Never transplant csvsort error results as executed csvstat evidence, because aggregation exception handling differs.

## Grammar, resources, cancellation and installed acceptance

These are mandatory future admission cells, separate from native statistical controls. Product-only security/lifecycle failures are explicit departures from unbounded native execution; no claim of native error-byte parity.

| Cell | Required acceptance |
| --- | --- |
| Grammar errors | Unknown/missing flag values, conflicting operations, bad selectors, ragged rows, malformed quoting, invalid codec/bytes and zero-column tables; independently captured stdout/stderr/status per admitted Python profile |
| Chunk equivalence | Each accepted fixture as one chunk, every single-byte chunk, every two-way byte split and seeded partitions; identical bytes/status; split BOM, UTF-8, CRLF, quote/escape pairs and multiline fields |
| Input accounting | Bound bytes, physical lines, records, columns, fields, retained table and inference attempts; charge skipped lines and repeated selections |
| Numeric accounting | Bound digits, exponents, precision expansion, Decimal operations and temporal microsecond/calendar work; no inaccurate fallback or partial statistics |
| Distinct accounting | Bound unique/frequency map entries, representative storage, equality/hash work and frequency ordering; ties stay stable at limits |
| Output accounting | Bound custom-format width/precision, JSON indentation, quoted/string growth and total bytes; charge before allocation and writes |
| Cancel boundaries | Pre-abort, pending VFS read, UTF-8/CSV parse, inference, Decimal aggregation/sqrt, unique/frequency ordering, formatting and blocked output; failure remains cancellation, never unavailable |
| Cleanup | Reader/stream ownership closed exactly once as required, pending writes released, all reservations reclaimed on success/error/cancel; subsequent invocation unaffected |
| Replay/realm | Preserve branded args/carrier byte identity and realm-owned values; replay same admitted capabilities/input reproduces bytes, no process clock/locale leakage |
| CLI/SDK | Same operation/selector/profile/budget/cancellation inputs give equivalent outputs and errors; SDK-only extensions identified separately |
| Packed artifact | Opt-in public ESM import and declaration compile from installed tarball without private packages; no private runtime/type specifiers, host imports or integration-held assets |

TDD sequence for implementation: introduce independently specified failing memory-VFS controls → minimal responsible-package code → focused maintained package lint/unit/build closure → boundary/packed-consumer checks. Native QA stays a markdown procedure, never a unit dependency or substitute for memory tests. Do not raise timeouts, suppress failures or count unexecuted cases as passes.

## Manual control rerun and completion gate

1. Authenticate exact oracle distributions and temporal source hashes; record all versions, Unicode/Babel/Decimal context, actual locale, timezone, encoding and explicit isolated clock/reference reads. Run only development oracles, never runtime fallback.
2. In `/out`, materialize fixtures exactly as specified; record argv, bytes (including BOM), stdout, stderr, status and oracle identity per cell. Keep source-derived and previously observed expectations separate from new captures.
3. Replay existing byte controls and all fixture/flag interactions; capture full CSV/JSON/text goldens, argument usage/error blocks and missing grammar/selection/nonfinite/rounding/temporal cells. No substring-only acceptance for byte-parity claims.
4. Independently review any mismatch; classify release-versus-source changes and deliberate product departures. Preserve original expectations rather than rewriting them to make implementation pass.
5. Later compare the same reviewed fixtures through CLI and SDK using memory VFS, cancellation/quota/chunk cells, then installed-artifact checks. Retain durable findings in this plan and purge temporary logs/evidence after review.

Research deliverable: pinned semantics, exact scalar/interaction controls, fixture inventory, provenance and explicit outstanding gates recorded. Command implementation, all-native-byte ledger, shared inference engine admission and full compatibility remain open. No package is published; no commit/push/release is claimed by this research document.
