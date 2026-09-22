# csvcut pinned behavior and independent acceptance matrix

Research task: `research-csvcut`. Date: 2026-09-20. This specifies future
acceptance; it does not implement or qualify a command.

## Compatibility identity and evidence

Select **csvkit 2.2.0 / agate 1.14.2 / Python 3.9**, with explicit UTF-8
stdout/stderr, unset `PYTHONIOENCODING`, and noninteractive stdin. The supplied
native observations are evidence from the request, not newly executed controls.
The exact Python patch version and native distributions must be authenticated
before future manual QA. Python 3.12+ quoting constants are outside this profile;
this does not narrow the supported JavaScript runtimes.

Source comparison target: csvkit
`194c904256a09dc203c460944d35e9d414244503`, agate
`34856488cfcbe9077af8e3e557cbf98a044fdd64`. Bounded HTTPS text inspection of
these files and csvkit tag `2.2.0` was performed without executing upstream code.
The companion [research record](safe-bash-csvcut-research.md) records hashes,
inspection scope, release differences and unresolved controls. A tag URL and
observed hash identify inspected bytes, not an authenticated installed oracle.

Default input decoding is deterministically `utf-8-sig`. Native csvkit actually
consults `PYTHONIOENCODING`; forbidding that ambient dependency is an explicit
isolation policy. Test an injected host value without adopting it. Output encoding
is explicitly UTF-8; do not inherit native terminal encoding.

## Exact interactions

1. Reader options: `-d/--delimiter`, `-t/--tabs` (wins over `-d` regardless of
   order), `-q/--quotechar`, `-u/--quoting`, `-b/--no-doublequote`,
   `-p/--escapechar`, `-S/--skipinitialspace`, `-z/--maxfieldsize`,
   `-e/--encoding`, `-H/--no-header-row`, `-K/--skip-lines`. Python 3.9
   quoting values are 0 MINIMAL, 1 ALL, 2 NONNUMERIC, 3 NONE. These configure
   input, not the writer. NONNUMERIC can convert unquoted input to floats even
   though csvcut does not perform table inference.
2. Without `-H`, the first parsed record supplies raw headers: no renaming,
   duplicate warning, null conversion or type inference. With `-H`, replay the
   first record as data and generate `a..z, aa, bb, cc, ...`. Width is established
   by that first record; never enforce uniform row widths.
3. `-c/--columns` defaults to all columns. Split selectors on commas without
   trimming tokens. An exact nonnumeric header matches before range parsing;
   first duplicate wins. Digit-looking headers are positional selectors.
   Python integer conversion also accepts surrounding numeric whitespace and
   signs: lack of token trimming does not mean integers use an ASCII-digit-only
   grammar. Unicode integer grammar requires its own profile controls.
4. Ranges use inclusive integer endpoints separated by `:` or `-`; colon has
   precedence. Names cannot be range endpoints. Empty endpoints use the source
   defaults below. Descending ranges are empty, not reversed. Preserve selector
   order and repetitions. Default origin is 1; `--zero` changes positions and
   names display to origin 0, without correcting upstream open-range defects.
5. `-C/--not-columns` removes every occurrence of matched positions from the
   inclusion list. Unknown individual names/indices are ignored. Invalid or
   out-of-bounds ranges fail. Resolve inclusion before exclusion.
6. `-x/--delete-empty-rows` evaluates projected cells: only all-empty results
   disappear. Spaces and textual `0` survive. Missing selected cells become
   empty output; excess input cells are discarded. Header always emits,
   including a zero-column header. Without `-x`, zero columns emit LF for every
   data record; with `-x`, all those data records disappear.
7. `-n/--names` bypasses selectors and row deletion, prints all raw headers as
   `%3i: %s\n`, and does not consume subsequent records. `-n -H` fails before
   header parsing. Empty ordinary input emits LF; empty names input fails.
   A parsed blank first record is different from EOF and yields zero headers.
8. Writer is comma, double quote, doubled quotes, minimal quoting, LF. Input
   dialect flags never change output dialect. Agate writer replaces every
   embedded CR with LF before quoting; a cell containing CRLF becomes two LF.
   Native text-opening universal-newline translation can occur earlier: direct
   writer-cell controls and native input-byte controls must be separate.
9. `-l/--linenumbers` inserts writer record numbers, beginning with header
   `line_number` then 1; after `-x`, numbering counts emitted records. It is not
   grep's physical parser `line_num`. `--add-bom` prefixes EF BB BF even in
   names mode and can precede an eventual failure.
10. `-K` skips physical decoded text lines before parsing, not CSV records;
    negative counts skip nothing in the selected source. `-n` still honors it.
    csvcut has **no sniff-limit option or sniff call**. Agate's standalone
    sniffer candidates/warnings are separate engine controls, not csvcut
    command behavior. No `-I`, `-L`, null/date conversion flags or
    `--ignore-unknown-columns` are admitted for the selected release.

## Fixture notation and independent controls

Strings below use JSON escapes, decoded once into UTF-8 bytes; `hex(...)`
specifies literal bytes. Argv is an array, never shell-split. Unless specified,
success expects stderr `""`, status 0; failure expects stdout `""`, status 1.
All rows are **specified, not executed**. Source-derived expected results are
independent literals; future controls must not call production parsing,
selection or serialization to construct expected values. Native runs are manual
QA only. Implementation unit tests use memory VFS/memfs and mocked capabilities.

| Fixture | Exact input |
| --- | --- |
| A | `"id,name,note\n1,A,x\n2,B,y\n"` |
| D | `"id,id,3,x-y,x:y\na,b,c,d,e\n"` |
| W | `"a,b,c\n1\n2,3,4,5\n,,\n, ,0\n"` |
| E | `"a,b\n,keep\n ,\n0,\n,\n"` |
| M | `"a,b\n\"x\ny\",z\nq,r\n"` |
| T | `"a\tb\n1\t2\n"` |
| Q | `"a;b\n'one;two';'it''s'\n"` |
| N | `"\"a\",\"b\"\n1,2\n"` |
| H | `"10,20\n30,40\n"` |
| B | `hex(efbbbf612c620d0a312c320d0a)` |

| ID | Input / argv | Exact stdout or failure stderr |
| --- | --- | --- |
| S01 | A / `[]` | `"id,name,note\n1,A,x\n2,B,y\n"` |
| S02 | A / `["-c","3,1,3"]` | `"note,id,note\nx,1,x\ny,2,y\n"` |
| S03 | A / `["--columns","name,id"]` | `"name,id\nA,1\nB,2\n"` |
| S04 | D / `["-c","id"]` | `"id\na\n"` |
| S05 | D / `["-c","3"]` | `"3\nc\n"` (position, not name search) |
| S06 | D / `["-c","x-y,x:y"]` | `"x-y,x:y\nd,e\n"` |
| S07 | A / `["-c","1-2"]` and `["-c","1:2"]` | `"id,name\n1,A\n2,B\n"` |
| S08 | A / `["-c",":2"]` and `["-c","-2"]` | `"id,name\n1,A\n2,B\n"` (negative token resolves as open range after positional failure) |
| S09 | A / `["-c","2-"]` | `"name,note\nA,x\nB,y\n"` |
| S10 | A / `["-c","3-1"]` | `"\n\n\n"` |
| S11 | A / `["-c","0,2","--zero"]` | `"id,note\n1,x\n2,y\n"` |
| S12 | A / `["-c",":1","--zero"]` | `"name\nA\nB\n"` (open start defaults to 1) |
| S13 | A / `["-c","1-","--zero"]` | `ColumnIdentifierError: Column 3 is invalid. The last column is 'note' at index 2.\n` |
| S14 | A / `["-c",""]` | same as S01; empty selector string is falsey |
| S15 | A / `["-c"," 1 ,+2"]` | `"id,name\n1,A\n2,B\n"` |
| S16 | A / `["-c"," name"]` | `ColumnIdentifierError: Column ' name' is invalid. It is neither an integer nor a column name. Column names are: 'id', 'name', 'note'\n` |
| S17 | A / `["-c","0"]` | `ColumnIdentifierError: Column 0 is invalid. Columns are 1-based.\n` |
| S18 | A / `["-c","4"]` | `ColumnIdentifierError: Column 4 is invalid. The last column is 'note' at index 3.\n` |
| S19 | A / `["-c","id-name"]` or `["-C","id-name"]` | `ColumnIdentifierError: Invalid range %s. Ranges must be two integers separated by a - or : character.\n` (release formatting defect) |
| S20 | A / `["-c","1,"]` | `ColumnIdentifierError: Column '' is invalid. It is neither an integer nor a column name. Column names are: 'id', 'name', 'note'\n` |
| C01 | A / `["-C","name,999,missing,0"]` | `"id,note\n1,x\n2,y\n"` |
| C02 | A / `["-c","2,1,2,3","-C","2"]` | `"id,note\n1,x\n2,y\n"` |
| C03 | A / `["-C","1-3"]` | `"\n\n\n"` |
| C04 | A / `["-C","2-"]` | `"id,note\n1,x\n2,y\n"` (release open-end exclusion defect) |
| C05 | A / `["-C","3-1"]` | same as S01 |
| C06 | A / `["-C","2-4"]` | same failure as S18 |
| C07 | A / `["-c","missing","-C","missing"]` | unknown inclusion error; exclusion does not rescue it |
| R01 | W / `["-c","3,1"]` | `"c,a\n,1\n4,2\n,\n0,\n"` |
| R02 | E / `["-c","1","-x"]` | `"a\n \n0\n"` |
| R03 | A / `["-C","1-3","-x"]` | `"\n"` |
| R04 | `"a\n\n\"\"\n"` / `[]` | `"a\n\"\"\n\"\"\n"` (single empty cell must be quoted) |
| R05 | `"a,b\nnull,001\n"` / `[]` | unchanged; no null/numeric conversion |
| N01 | A / `["-n"]` | `"  1: id\n  2: name\n  3: note\n"` |
| N02 | D / `["--names","--zero"]` | `"  0: id\n  1: id\n  2: 3\n  3: x-y\n  4: x:y\n"` |
| N03 | A / `["-n","-c","missing","-C","bad-range","-x"]` | same as N01 |
| N04 | H / `["-n","-H"]` | `RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.\n` |
| N05 | `""` / `[]` and `["-H"]` | `"\n"` |
| N06 | `""` / `["-n"]` | `StopIteration: \n` |
| N07 | `"\n"` / `["-n"]` | `""`, status 0 (blank record, not EOF) |
| H01 | H / `["-H"]` | `"a,b\n10,20\n30,40\n"` |
| H02 | one record with cells 1 through 29 / `["-H","-c","26-29"]` | `"z,aa,bb,cc\n26,27,28,29\n"`; input is integers 1..29 joined by comma plus LF |
| H03 | `"ignored\nid,name,note\n1,A,x\n"` / `["-K","1"]` | `"id,name,note\n1,A,x\n"` |
| H04 | A / `["-K","99"]` | `"\n"` |
| H05 | A / `["-K","-1"]` | same as S01 |
| D01 | T / `["-d",";","-t"]` and `["-t","-d",";"]` | `"a,b\n1,2\n"` |
| D02 | Q / `["-d",";","-q","'"]` | `"a,b\none;two,it's\n"` (semicolon requires no output quoting) |
| D03 | M / `[]` | `"a,b\n\"x\ny\",z\nq,r\n"` |
| D04 | B / `[]` | `"a,b\n1,2\n"` |
| D05 | `hex(612c620ae92c320a)` / `["-e","latin-1"]` | `"a,b\né,2\n"` UTF-8 output |
| D06 | same bytes / `[]` | `Your file is not "utf-8-sig" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n`; buffering/partial output requires native capture |
| D07 | `"a,b\n1, 2\n"` / `["-S"]` | `"a,b\n1,2\n"` |
| D08 | N / `["-u","2"]` | `"a,b\n1.0,2.0\n"` |
| D09 | `"a,b\n1,2\n"` / `["-u","2"]` | `ValueError: could not convert string to float: 'a'\n` |
| D10 | `"a,b\nx\\,y,z\n"` / `["-u","3","-p","\\"]` | `"a,b\n\"x,y\",z\n"` |
| O01 | A / `["-l","-x"]` | `"line_number,id,name,note\n1,1,A,x\n2,2,B,y\n"` |
| O02 | A / `["--add-bom","-n"]` | EF BB BF followed by N01 bytes |

S08, S12, S13, C04 and S19 are mandatory separate release/source controls,
not opportunities to normalize upstream defects. C07's exact stderr is S16's
template with `missing` instead of ` name`.

## Grammar, error and Python-version cells still requiring native capture

These are acceptance requirements, **not passes or invented exact stderr**.
Each needs literal fixture bytes, argv, stdout/stderr hex and status before
claiming full compatibility. For argparse errors expect status 2 and empty
stdout; record the entire Python-3.9 usage preamble and diagnostic, not merely
an error substring. Runtime exceptions ordinarily produce status 1, but
setup failures before the exception hook require separate capture.

| ID | Independent control / required result |
| --- | --- |
| G01 | `-c2,1`, `--columns=2,1`, grouped `-nx`, repeated `-c 1 -c 2` (last wins), both flag orders; compare literal S02/N01-derived outputs |
| G02 | `--` followed by a literal VFS name `-input.csv`; omitted path and `-` read supplied stdin; second operand fails; no shell/glob expansion |
| G03 | Missing `-c/-d/-e` value; unknown flag; ambiguous long abbreviation; unambiguous argparse abbreviation: exact release diagnostics/status |
| G04 | Reject `--ignore-unknown-columns`, `-I`, `-L`, `--blanks`, `--null-value`, date options, `--snifflimit`; none is silently ignored |
| G05 | `-u 4`, `-u x`, `-z x`, `-K x`: Python-3.9 choice/type errors; additional Python constants get separate profiles |
| G06 | Multi-character/empty delimiter, quote and escape; `-q ''` Python-3.9 behavior; no silent dialect replacement |
| G07 | Numeric token whitespace, sign, underscore, Arabic/fullwidth digits, superscript `²`; exact `.isdigit()` versus `int()` precedence, including matching header names |
| G08 | `1:2-3`, `1--2`, `:`, `-`, open exclusion with `--zero`, descending/out-of-range endpoints, comma-bearing/empty headers and empty tokens |
| P01 | Unterminated quote `a,b\n"x,y`; junk after close `a,b\n"x"q,y\n`; quote in unquoted cell `a,b\nx"y,z\n`: Python reader defaults to non-strict, not RFC4180 validation |
| P02 | `-b` alone and with `-p`; doubled quote and escaped newline split fixtures; `-u 0/1/2/3` each receives independent reader/writer controls |
| P03 | NUL inside and outside quotes on Python 3.9; capture exact exception/partial output, then keep later Python acceptance separate |
| P04 | Invalid UTF-8 sequences, incomplete sequence at EOF, invalid codec name, BOM with explicit utf-8 versus default utf-8-sig; deterministic host-independent decoding |
| P05 | Field-size limit exact/one-over, negative/zero `-z`, global Python limit versus invocation-local product budgets; no ambient limit inheritance |
| P06 | Direct writer cells `x\ry`, `x\r\ny` expect `"x\ny"\n`, `"x\n\ny"\n`; independently capture native stdin/file newline translation before writer |
| P07 | `-K 1` over multiline quoted data, CR-only lines, CRLF lines, EOF in skip; prove physical line skip and distinguish from logical records |
| P08 | Names with embedded LF/tab, positions 99/100/1000, only header, blank first row followed by nonempty data; names does not parse later malformed records |
| P09 | Multiline M with `-l`: writer numbering 1/2; shared grep control separately checks physical `line_num` 3/4 minus header offset, not writer count |
| P10 | Standalone agate sniffer comma/tab/semicolon/space/colon/pipe, failure warning+dialect=None, explicit kwargs override; do not invoke sniffer for csvcut |
| P11 | `-h/-V` output, `-v` traceback and setup errors, interactive wait message, `--add-bom` before failure; capture and explicitly delimit host-dependent traceback deviations |
| P12 | Native compressed-extension opening versus raw VFS bytes: require explicit admitted compression profile or document unsupported capability; never invoke native tools |

## Product safety and installed-consumer cells

Every applicable semantic cell runs through CLI and SDK with equal input/options
and exact output/errors. Keep these product controls separate from the native
compatibility fixtures. No existing command means all cells below are open.

| ID | Required verification |
| --- | --- |
| B01 | Every single-byte cut of B/M/Q and multibyte UTF-8, empty chunks, CRLF/quote/escape boundaries and byte-at-a-time input equals one-chunk control |
| B02 | Abort before acquisition, during read/decode/parse/select, between writes and blocked sink; preserve exact falsey cancellation reason and precedence |
| B03 | Sink writes awaited; failed sink/parser/VFS read closes owned input once; registered cleanup precedes acquisition; borrowed streams not independently closed |
| B04 | Input, decoded, retained, cells/columns, field, selector expansion, work and output budgets: exact limit and one-over, rollback, repeated invocation recovery, no unbounded ranges |
| B05 | Preserve producer chunk ownership under mutation/reuse; owned result bytes and reservations live only for the declared invocation; realm brands remain canonical |
| B06 | Memory-VFS pipelines, redirects and .sh invocation; stdin provenance; literal paths, symlink aliases and denied paths; forwarding uses existing signal and budgets |
| B07 | Pre-output selector failure is empty output except explicit BOM; late reader/sink failures report actual partial output without an atomicity claim |
| B08 | No host executable, network, credentials, ambient files, dynamic download, native/WASM fallback; mocked denied capabilities must not be invoked |
| B09 | Original/checkpoint/replay result parity, budget accounting, ownership and cleanup; each advertised realm separately qualified |
| B10 | Installed safe-bash runtime and strict TypeScript consumer import `@poe-platform/safe-bash/commands/csvcut` without any private workspace installed; declarations/runtime contain no leaked private dependency |
| B11 | CLI screenshots for command/help/names/errors; manual validation only, no screenshot unit tests |

## Ownership and admission gates

Future logic belongs in `packages/safe-bash-command-csvcut`, manifest name
`safe-bash-command-csvcut`, `private: true`, TypeScript ESM, no external runtime
dependencies. Shared parsing/selection may use admitted first-party engines;
csvcut's ragged-row and no-inference behavior must remain explicit. Do not import
integration-held XAN sources. safe-bash only composes/exports the command at
`./commands/csvcut`; no default registration change and no command-to-safe-bash
dependency cycle. Canonical contract brands/constructor identities must survive
bundling. Bundle implementation and declarations in the published safe-bash
artifact; do not publish the private package.

Follow the requested package-pattern document (currently relocated by unrelated
edits to `docs/plans/archive/safe-bash-command-package-pattern.md`). Use maintained
build/package/installed-consumer checks, not direct tsc as a build substitute.
Engine, behavior, command and safety implementation remain separate later tasks.
Start each validated repair or implementation increment with failing independent
memory-VFS tests. Native executables never become a unit-test dependency.

Manual QA: authenticate oracle versions and sources, freeze declared encoding,
capture each fixture's argv/input/output/error bytes/status, then compare CLI and
SDK. Record exceptions and missing cells explicitly. Store temporary captures
under `/out` and purge after durable evidence is recorded. A literal expected
matrix, a passing engine suite or a native sample is not full compatibility.
