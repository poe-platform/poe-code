# csvgrep pinned behavior and independent acceptance controls

Research task: `research-csvgrep`; 2026-09-20. This is a specification and manual QA ledger, not implementation or a compatibility pass. No native executable was run during this task. Supplied observations are attributed below; newly constructed fixtures remain independent expected controls until executed.

## Current-main inspection and delivery boundary

Inspected local `main` HEAD `35d01c57f8078d8afa916dc59929395d857e9c55`: tracked paths contain the csvgrep plan, but no csvgrep workspace, implementation, tests or export. Working-tree searches of packages/scripts also found none. Absence is concrete evidence for a future feature, not a validated runtime defect. Remote-main equality was not verified.

Read the tracked `docs/plans/safe-bash-command-package-pattern.md` using `git show HEAD:...` and its working-tree successor [archived pattern](archive/safe-bash-command-package-pattern.md). Preserve the unrelated move. Implementation belongs in `packages/safe-bash-command-csvgrep`, name `safe-bash-command-csvgrep`, `private: true`, TypeScript ESM, no external runtime dependencies. Do not create an empty scaffold for research. Expose opt-in `@poe-platform/safe-bash/commands/csvgrep`; safe-bash only composes/exports. Bundle implementation and declarations without unpublished JS/d.ts imports. No publication authorized.

Use the acyclic contracts/engines → command → safe-bash graph, canonical realm-owned brands and constructors. Verify maintained build/export declarations, installed consumers and CLI/SDK equivalence during later tasks. `packages/safe-bash/integration-boundaries.json` holds XAN CSV and selector sources; this research does not admit their extraction or import. Byte streams, VFS-only I/O, explicit signals, cleanup, bounded allocation/work/output, producer ownership and replay invariants remain mandatory.

## Pinned evidence profiles

Source specification S: csvkit `194c904256a09dc203c460944d35e9d414244503`, agate `34856488cfcbe9077af8e3e557cbf98a044fdd64`. Retrieved and inspected during this task:

- [csvgrep.py](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/utilities/csvgrep.py): flag validation, precedence, header/output sequencing.
- [grep.py](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/grep.py): falsey pattern omission, missing fields, aggregation, Python search.
- [cli.py](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/csvkit/cli.py): shared flags, selectors, decoding, physical skips, diagnostics.
- [csv_py3.py](https://github.com/wireservice/agate/blob/34856488cfcbe9077af8e3e557cbf98a044fdd64/agate/csv_py3.py): parser physical line numbers, writer CR replacement, sniffer.
- [upstream csvgrep tests](https://github.com/wireservice/csvkit/blob/194c904256a09dc203c460944d35e9d414244503/tests/test_utilities/test_csvgrep.py): independent match/invert/any/regex/BOM/line-number controls. These do not cover the entire matrix here.

Release observation R: user-supplied csvkit 2.2.0 / agate 1.14.2 / Python 3.9 observations, including 90 additional pattern controls. Exact patch versions/distribution hashes and full raw transcripts were not supplied here. Counts are historical observations, never candidate passes. Do not conflate later source changes with these release bytes.

Intentional product profile P: default UTF-8-sig independent of host `PYTHONIOENCODING`; deterministic UTF-8 output and concise `error:` diagnostics; bounded patterns and VFS match files. S explicitly defaults encoding from `PYTHONIOENCODING`, uses ambient `argparse.FileType('r')` for match files, and formats uncaught regex errors as exception-name plus message. R supplies `error: missing ), unterminated subpattern at position 0`. Record this discrepancy, rather than claiming the S source proves that exact R stderr. Match-file native encoding is not guaranteed by CSV `-e`; define explicit VFS decoding as UTF-8-sig in P and qualify alternate encodings independently.

## Exact flag interactions

`-c/--columns` is required and truthy unless `-n/--names`; at least one of `-r/--regex`, `-m/--match`, `-f/--file` must be supplied (presence, not truthiness). These three flags are not mutually exclusive. Repeated scalar flags use their last value; resource/error effects of discarded `-f` arguments require controls because native argparse opens them eagerly.

Choose a truthy regex first, otherwise match-file, otherwise substring. Thus empty `-r` falls through, whereas a compiled nonempty regex overrides literal and file matching. Native file argument admission can fail even if regex wins. An empty file yields an active membership predicate with an empty set; an empty literal or absent literal yields no predicates. Default aggregate is all; `-a/--any-match` is any; `-i/--invert-match` negates the aggregate once. Zero predicates: all=true, any=false. Header always emitted, no matches status 0. Missing selected fields test as empty string, without padding output rows.

Literal is case-sensitive substring, not exact membership. Regex is Python `re.search`, not `match` or JS RegExp. Match-file iterates physical text lines, applies Python `str.rstrip()` with no argument to every line, then deduplicates exact strings. LF/CRLF/final unterminated lines, trailing tabs/spaces/NBSP, blank lines and empty files differ. No trimming of the cell or leading file whitespace.

Python 3.9 whitespace profile for rstrip: U+0009–000D, U+001C–001F, U+0020, U+0085, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000. Pin an independent table control; JS trim is not equivalent (notably U+FEFF and U+001C).

Selectors are ordered comma-separated positions/names/inclusive ranges. Numeric-looking identifiers are positional even with numeric headers; exact nonnumeric names win before range parsing; first duplicate header wins. No explicit token trimming. Preserve repeated selector order at selector API boundary, though csvgrep builds a dictionary and collapses repeated indices for matching. Python integer conversion accepts whitespace in numeric tokens: do not infer that a spaced numeric token necessarily errors from the absence of name trimming. Open ranges, reversed ranges, colon ranges and `--zero` require versioned independent controls; S defaults an omitted lower bound to 1 even under zero mode.

## Shared dialect, decoding and numbering

| Surface | Contract / qualification requirement |
| --- | --- |
| `-d`, `-t` | Tab overrides delimiter in either argv order. Output remains comma/LF. |
| `-q`, `-u`, `-b`, `-p`, `-S` | Input quotechar, quoting, no-doublequote, escapechar, skipinitialspace. Explicit reader kwargs override dialect fields. Validate character lengths and argument errors independently. |
| `-e` | CSV input decoding; P default UTF-8-sig. BOM, invalid sequences, split multibyte sequences and unknown codecs need exact profiles. |
| `-z` | Field-size limit; implementation accounting invocation-local, never native global mutation. |
| `-K` | Skip physical lines before parser/header; no logical-record skipping. |
| `-H` | Generate a..z, aa, bb, cc headers; first row is data. |
| `-l` | Reader numbering before filtering, `line_numbers` header. Physical parser line_num minus one with header, line_num headerless. Selector offsets adjust for inserted column. |
| `-n`, `--zero` | Names shortcut precedes search validation; headerless names is an error. Exact names bytes/zero/line-number interactions need controls. |
| `--add-bom`, `-v`, `-V` | Output BOM, verbose diagnostics, version shortcut require separate controls. Native BOM can be emitted before a later failure. |
| inference flags | csvgrep overrides L/I: no locale, no inference/null/date options. Values remain reader values, not agate inferred table values. |
| sniffing | Shared Sniffer candidates comma/tab/semicolon/space/colon/pipe; warning and dialect=None on failure. S csvgrep uses reader directly and does not expose `-y`; do not silently add csvsort sniff CLI flags to csvgrep. |
| writer | Every embedded CR becomes LF before quoting; CRLF becomes two LF when retained in a cell. Input universal-newline conversion can differ between native stdin/file paths, so qualify transport separately. |

Python 3.9 quoting constants 0–3 form the release baseline. S discovers constants dynamically, so later Python constants must be a separate profile. Non-numeric quoting can produce numeric values before matching; qualify type errors instead of silently stringifying. Explicit profiles must cover permissive Python CSV versus strict parsing, malformed quotes, NUL (S LazyFile strips NUL on file iteration but not the same path as stdin), blank records, empty input, compressed input and multiline headers. No RFC4180 replacement claim without a documented deviation. Compression/codec support is not permission for native/WASM fallbacks or downloads.

## Independent exact fixture controls

JSON string notation denotes exact UTF-8 bytes, including final LF; `\u` denotes Unicode code points. Run with piped input to avoid terminal waiting diagnostics. No sniff flag. Unless overridden argv begins `["-c","x"]`, stderr is `""`, status 0. Each row is a constructed independent expectation C from S/R, not a newly executed native result. Keep these expectations outside implementation-derived tests.

Base B = `"x,y,id\na,a,1\na,b,2\nb,a,3\nb,b,4\n"`; H = `"x,y,id\n"`.

| ID | Input / match file | argv after prefix | Exact stdout |
| --- | --- | --- | --- |
| substring | B | `-m a` | `"x,y,id\na,a,1\na,b,2\n"` |
| all | B; replace columns with x,y | `-m a` | `"x,y,id\na,a,1\n"` |
| any | B; columns x,y | `-m a -a` | `"x,y,id\na,a,1\na,b,2\nb,a,3\n"` |
| inverted-all | B; columns x,y | `-m a -i` | `"x,y,id\na,b,2\nb,a,3\nb,b,4\n"` |
| inverted-any | B; columns x,y | `-m a -a -i` | `"x,y,id\nb,b,4\n"` |
| none | B | `-m z` | H |
| empty-literal | B | `-m ""` | B |
| empty-literal-any | B | `-m "" -a` | H |
| empty-literal-invert | B | `-m "" -i` | H |
| empty-literal-any-invert | B | `-m "" -a -i` | B |
| regex-precedence | B; file F=`"a\n"` | `-r ^b$ -f F -m a` | `"x,y,id\nb,a,3\nb,b,4\n"` |
| file-precedence | B; F=`"b\n"` | `-f F -m a` | `"x,y,id\nb,a,3\nb,b,4\n"` |
| empty-regex-file | B; F=`"b\n"` | `-r "" -f F -m a` | same as file-precedence |
| empty-regex-literal | B | `-r "" -m a` | same as substring |
| empty-regex-alone | B | `-r ""` | B |
| empty-regex-alone-any | B | `-r "" -a` | H |
| file-empty | B; F=`""` | `-f F` | H |
| file-exact | `"x,id\na,1\nza,2\na ,3\n a,4\n"`; F=`"a\n"` | `-f F` | `"x,id\na,1\n"` |
| file-rstrip | `"x,id\na,1\na ,2\na\t,3\n,4\n"`; F=`"a \na\t\n\u00a0\n"` | `-f F` | `"x,id\na,1\n,4\n"` |
| file-crlf-final | B; F=`"a\r\na"` | `-f F` | same as substring |
| short-row | `"x,y\na\na,b\n"`; columns y | `-r ^$` | `"x,y\na\n"` |
| short-row-any | same; columns x,y | `-m a -a` | `"x,y\na\na,b\n"` |
| search-not-match | `"x,id\nzabc,1\nzzz,2\n"` | `-r abc` | `"x,id\nzabc,1\n"` |
| unicode-digit | `"x,id\n\u0661,1\n1,2\na,3\n"` | `-r "\d"` | `"x,id\n\u0661,1\n1,2\n"` |
| ascii-digit | same | `-r "(?a)\d"` | `"x,id\n1,2\n"` |
| dollar-final-lf | `"x,id\n\"abc\n\",1\nabc,2\n"` | `-r ^abc$` | unchanged input |
| absolute-end | same | `-r "\Aabc\Z"` | `"x,id\nabc,2\n"` |
| physical-number | `"x,id\n\"a\nb\",1\nc,2\na,3\n"` | `-m a -l` | `"line_numbers,x,id\n2,\"a\nb\",1\n4,a,3\n"` |
| tabs-override | `"x\ty\na\tb\n"` | `-d ";" -t -m a` | `"x,y\na,b\n"` |
| numeric-header | `"2,x\na,b\n"`; columns 2 | `-m b` | unchanged input |
| duplicate-header | `"x,x\na,b\nb,a\n"` | `-m a` | `"x,x\na,b\n"` |
| range-name | `"a-b,x\na,b\n"`; columns a-b | `-m a` | unchanged input |
| repeated-selector | B; columns y,x,y | `-m a` | same as all |
| spaced-name | B; columns ` x` | `-m a` | `""`; status 1, exact ColumnIdentifierError stderr requires transcript |
| invalid-regex | B | `-r "("` | `""`; status 1, R/P stderr `"error: missing ), unterminated subpattern at position 0\n"`; S exception-prefix differs |

Argument-error controls: missing `-c`, missing all pattern options, missing option value, unknown flag and extra positional operand each expect empty stdout/status 2 (without --add-bom). Semantic error suffixes for first two are respectively `You must specify at least one column to search using the -c option.` and `One of -r, -m or -f must be specified, unless using the -n option.` Exact argparse usage prefix/full stderr remains unexecuted; capture it separately for release and S. Do not mark these exact-stderr cells passing from suffix checks.

## Declarative regex grammar and bounded semantics matrix

No syntax below is implicitly admitted by JS support. Every implemented construct requires explicit grammar, versioned Unicode semantics, deterministic errors and charged work. Unsupported constructs fail before output; full Python compatibility stays open until qualified.

| Grammar family | Independent controls |
| --- | --- |
| literals, escapes, dot, alternation, groups | Unicode/non-BMP, escaped punctuation, dot versus LF, empty alternatives, malformed/unclosed groups and bad escapes with positions |
| classes and categories | Unicode digit/space/word and complements; ASCII inline flag; ranges, negation, category inside class; Python whitespace table versus JS |
| anchors | ^/$ with final LF; multiline internal lines; absolute \A/\Z; word boundaries with Unicode |
| flags | global/scoped a,i,m,s,x,u; invalid combinations/placement; verbose escaped spaces and comments |
| Unicode ignore-case | `(?i)[a-z]` on İ, ı, ſ, K and Latin; output preserves original bytes |
| captures/backreferences | `(?P<x>a)(?P=x)` on aa/ab, numbered references, unmatched groups and invalid names/references |
| assertions | fixed-width lookbehind on za, negative lookbehind, lookahead, rejection of variable-width lookbehind |
| quantifiers | greedy/lazy, bounded repetitions, invalid bounds, nesting, empty repeated assertions, pathological `(a+)+$` |
| later Python grammar | Atomic groups/possessive quantifiers and later additions are not Python 3.9 baseline; separate versioned unsupported/error cells |

No mechanically forwarded Python syntax or host re. Admission/compile budgets, pattern bytes, AST nodes, capture state, input code points and execution steps must be explicit. Backreferences/lookaround may need a more restrictive documented bounded capability; unsupported is not a native compatibility pass. Invocation-local work exhaustion must stop predictably without unbounded synchronous JS or a larger timeout.

## Chunk, errors, cancellation and isolation acceptance cells

These are product safety controls P, independent of native semantic observations. Later TDD tests use memory VFS or memfs and mocked capabilities only; no executable, network or fixture downloads in unit tests.

| Cell | Required evidence |
| --- | --- |
| chunk equivalence | Every byte split for small fixtures, including UTF-8/BOM/CRLF/quote/escape boundaries and match-file lines; same bytes/status as unsplit. Empty chunks do not alter parsing. |
| encoding errors | Invalid UTF-8, unknown codec, truncated final sequence; versioned exact stdout/stderr/status, including partial output policy. |
| parser errors | Strictness, all quoting constants, NUL stdin versus VFS, malformed header/record, field budget, numeric reader values; pin native profile before claiming parity. |
| file containment | Literal VFS paths, traversal/symlink containment, missing/denied/read failure, `-f -` shared stdin consumption, unused winning/losing file flags; no host fallback. |
| file retention | Bytes read, decoded units, line size, unique entries and retained set bytes charged locally; duplicate lines still charge input/work. |
| cancellation | Before admission, during CSV read/file read/compile/search and blocked sink write; signal forwarded, owned iterators closed, no post-abort writes. |
| cleanup | Register before acquisition; read/write/cleanup rejection, falsey thrown values and cancellation races; release reservations exactly once. |
| backpressure/ownership | Await every sink write, producer mutation cannot change retained bytes, bounded queued output, final writer failure propagated. |
| budget isolation | Exhaust then rerun; parallel invocations independent; retained table/record/field/output and regex limits; no global pattern cache leaking reservations. |
| realm/replay | Canonical byte argument brands/carrier identity and errors survive packed imports; deterministic replay, no ambient time/locale/encoding/network. |
| CLI/SDK | Identical mode precedence, selectors, dialect, encoding, result bytes, structured errors and status; unsupported flags explicit. |

## Manual QA protocol and remaining qualification

Authenticate release distributions and record Python patch/Unicode version, locale, encoding, argv, fixture bytes, source hashes and candidate revision. Run each independent cell manually against the pinned oracle and candidate separately. Capture exact stdout/stderr bytes, status and VFS effects; include failure/unsupported outcomes. Native executable use is manual development QA only. Preserve durable summarized evidence here; temporary transcripts go in `/out` and are purged after use.

Open cells: full argument stderr, regex S/R diagnostic discrepancy, match-file decoding/whitespace table, selector open/zero ranges, numeric-token whitespace, parser strictness/quoting/NUL/encoding profiles, multiline headers, headerless >26 columns, transport newline differences, names/BOM/version shortcuts, grammar coverage, all chunk/error/cancellation/resource controls and installed consumer proof. None is a candidate pass. No runtime repair, commit, push or release was performed. Research pinning is complete; full compatibility and downstream engine/wiring tasks remain open.

## Candidate behavior increments (2026-09-20)

The earlier absence findings are superseded for the following candidate increments only. Original implementation now lives in private `safe-bash-command-csvgrep`, with shared parsing/selection/serialization in private `safe-bash-csv-engine`. No held XAN implementation was read or admitted. The package-pattern instructions were read at their archived successor without restoring the deleted document. Safe-bash's command entry only exports the command workspace; the existing qualified artifact traversal bundles runtime and rewrites private declaration references.

| Increment | Independently reviewed candidate evidence | Qualification |
| --- | --- | --- |
| Decoded row matching | `src/match.test.ts` and `src/command.test.ts`: all/any, inversion after aggregation, vacuous empty-pattern combinations, truthy regex/file/literal precedence, missing selected fields as empty, emitted short rows unchanged, header-only success. | Candidate unit controls pass; no new native transcript claimed. |
| CSV transport | Engine `src/index.test.ts`: every byte split of BOM/multibyte/quoted CRLF input; physical multiline positions including consumed-line numbering at permissive quoted EOF; skipped physical lines precede parser numbering; comma/LF writer transforms each CR; numeric positions, exact range-like names, duplicate/repeated selectors, oversized decimal numeric headers remaining positional, and untrimmed names. Command controls add tab override and physical numbers before filtering. | Explicit `utf8-sig-permissive-v1` candidate profile. Full Python reader qualification stays open. |
| Match-file membership | Command controls: exact membership after all trailing Python Unicode whitespace, CRLF/final unterminated line, every byte split, empty set, precedence avoiding losing file acquisition, unique-entry exhaustion and concurrent isolation. Matcher test independently enumerates all 29 Python whitespace code points and excludes BOM. | UTF-8-sig VFS profile; other codecs and native transport-specific behavior remain open. |
| Regex grammar | `bounded-sequence-v1`: literals/escaped punctuation/dot, classes/ranges/negation, Unicode-13 Nd and Python whitespace categories/complements, initial a/i/m/s combinations, ASCII ignore-case literals and same-case letter ranges including İ/ı/ſ/K, search candidates, final-LF dollar, absolute and multiline anchors. Invalid `(` has exact release diagnostic. Complete unsupported groups, non-ASCII ignore-case patterns and mixed-case/nonletter ignore-case ranges fail explicitly. A failing admission control reproduced the mixed-case endpoint-folding issue before its repair. | Supported subset controls pass. Unsupported constructs are not native compatibility passes. |
| Invocation safety | Acquisition follows synchronous cleanup registration. Cooperative blocked-read cancellation forwards the signal and closes the producer once. Input/sink falsey failures escape; simultaneous execution/cleanup failures retain both in AggregateError. Reused producer storage and awaited writes preserve byte output. A failing constructor/species control led to intrinsic byte-storage views rather than producer-controlled slicing. Names stops producer advancement after a completed header. | Tested candidate safety controls; opaque uncooperative host work is not force-preempted. |
| Public composition/artifact | Opt-in Shell plugin tests exercise VFS scripts, pipes, redirects, registry collision, actual SDK parity and mocked network denial. Literal constructor/toString/__proto__ basenames are covered; a failing control reproduced inherited flag-table lookup before own-key admission replaced it. Packed-consumer unit proof removes `/repo` before resolving public imports and executes in a Buffer-free realm; installed tarball QA checks runtime and NodeNext declarations through the public command subpath. | Private workspaces are not installed or independently published. |

Resource review: the invocation-local ledger separately bounds input bytes, decoded UTF-16 bytes, conservative retained allocations/peak, output bytes, argument and pattern bytes, set entries/storage, parser cells, scanned selected cells, field storage and work. Parser/writer concatenation charges growing intermediate lengths; selector hashing charges decoded header lengths, and selector split storage is admitted before allocation. Pattern source bounds compile nodes and class predicates. Search charges every start/atom/category/class check; it does not use JS RegExp, host re, workers, downloads or fallback engines. Worker queues, recursion and global caches are zero. Set duplicates still charge input, decoding and work. Retention conservatively accumulates allocation credit until invocation cleanup; it does not claim exact RSS or refund intermediate allocations. Empty pulls and chunk boundaries can affect allocation/work exhaustion; semantic every-byte-split controls use sufficient budgets. Diagnostics share output/work limits and may reject if the exhausted ledger cannot admit them.

The engine README pins candidate parser deviations: fatal UTF-8-sig only; UTF-16 field-byte units; quoting 0/3 only; retained NUL for either transport; permissive quote closure and EOF rules; no Sniffer. Exact native malformed-CSV/quoting/NUL/codec profiles remain open. ASCII decimal numeric-token whitespace is qualified; non-ASCII numeric syntax and open/zero ranges are not a compatibility pass. Headerless generated names beyond 26, multiline headers, native names shortcut spacing, BOM/version/verbose shortcuts, compression, `-f -` shared-stdin semantics, full argparse stderr, path/symlink containment across specific backing adapters, blocked-sink/cleanup races and complete replay/realm profiles require further independent controls. Regex captures/backreferences/assertions/word categories/repetition/alternation/scoped or verbose flags and later Python grammar remain unsupported and open. Full csvkit compatibility is not claimed.

Temporary manual evidence is generated under the workspace `out/` (absolute `/out` is read-only in this environment) and purged after review. The screenshot was inspected for selected-row CSV output, inversion, physical numbering and concise invalid-pattern diagnostics. No native executable is a unit-test dependency. Delivery: local prerequisite commit `ab1fa8d34` (`feat(safe-bash): admit private CSV engine declarations`) authenticates the reviewed declaration build authority. The command feature remains in the working tree. No push, verified remote-main delivery, release or private command publication occurred.


## Final candidate verification (2026-09-20)

The final focused run passed 35 independent command, matcher, CSV engine and Shell boundary tests. Both command/engine maintained lint and type checks passed, as did repository `npm run lint`. Selected maintained safe-bash build closure and fresh command workspace closure passed. Artifact unit checks passed 164 tests; the packed isolated private-graph control also passed after the final repairs. Fresh public safe-fs/safe-bash tarballs were packed and installed offline with lifecycles disabled; public csvgrep runtime controls and strict NodeNext type consumption passed without installing private workspaces. The CLI screenshot was inspected. These are candidate implementation checks, not native compatibility certification.

The complete `npm test` attempt completed the safe-bash discovery with 42,734 tests: 41,903 passed, 829 skipped by existing profiles, two failed and none cancelled. Both failures were archive-authority checks executed before the reviewed build metadata was committed. The exact failing Pandoc authority control passed after local commit `ab1fa8d34`; the subsequent complete exports/archive control rerun passed all 224 tests with no skips. Earlier shared Vitest batches passed. The full command returned status 1 and was not rerun end to end, so a green full-repository test run is not claimed. No assertions, admission controls or timeouts were weakened.

## Follow-up task-diff review (2026-09-20)

Reviewed the existing candidate command, matcher, shared engine, public composition and artifact controls without replacing other contributors' edits. Two independently reproduced failing controls were repaired: SDK dialect string values now consume argument/retention/work budgets alongside top-level SDK strings; `--tabs=value`, `--no-doublequote=value` and `--skipinitialspace=value` now reject attached values with argument status 2 instead of silently enabling the flag. Both repairs use existing accounting/argument logic, with no new abstraction or dependency.

Additional independent candidate controls pass for headerless columns 27/28 (`aa`, `bb`) and physical numbering after a multiline header. These close candidate-control gaps only, not native version qualification. A suspected output-close failure was not validated: the supplied ByteSink contract does not expose the proposed close hook. No repair for that hypothesis was retained. Existing falsey execution/input-cleanup aggregation controls remain passing.

Fresh affected verification: 28 command/matcher tests, nine shared CSV engine tests and one Shell boundary test passed (38 total); maintained command lint and both source/test TypeScript checks passed. The private artifact routes passed 158 tests, including isolated packed public-subpath execution without private workspace resolution and shared branded contract identity. The screenshot was inspected for selected-row output and concise attached-value status-2 diagnostics; temporary QA script and image were removed afterward. No external executable oracle was used in tests, no snapshots or compatibility versions changed, and no private command publication occurred.

Full compatibility remains incomplete: native CSV codec/quoting/NUL/error profiles, unsupported regex grammar, open/zero range qualification, shared-stdin match files and the remaining adapter containment/cancellation/replay cells above stay open and block a full-compatibility completion claim. Supported-profile review found no further validated code defect. This follow-up created no commit, push, verified remote-main delivery or release.

The follow-up maintained selected build closure `npm run build:workspaces -- --workspace=@poe-platform/safe-bash` also completed successfully, including command implementation/declarations, qualified safe-bash build and optional CLI postbuild.

## Integer argument increment (2026-09-20)

Independent failing controls reproduced JavaScript numeric syntax admission for
`--skip-lines=0x1` and a safe-integer conversion rounding error. Both are repaired
with bounded decimal parsing. ASCII decimal digits, leading plus, surrounding
Python whitespace and between-digit underscores have candidate controls;
Unicode decimal digits and signed-negative native behavior remain unqualified.
All 30 command/matcher tests, nine engine tests, one public Shell boundary test
and 158 private artifact tests passed. Command lint/type checks and the maintained
safe-bash selected build closure passed. Built public-entry manual CLI/SDK QA
passed, and the terminal screenshot was inspected. See
`safe-bash-csvgrep-integer-qa.md` for steps, failure history and scope. No full
repository gate, native compatibility completion, commit, push, release or private
package publication is claimed. Prior open matrix cells remain open.
