# CSV byte-stream engine

Read selected CSV cells and serialize rows without native tools or external runtime dependencies. This private engine supports safe-bash command workspaces; applications use their safe-bash command exports.

`CsvParser.push(bytes)` and `end()` return decoded rows with physical parser line numbers. `selectColumns()` retains selector order and repeated positions. `serializeRow()` writes comma/LF and converts each embedded CR to LF. `generatedHeaders()` uses a..z, aa, bb, cc.

Pass synchronous `{ text(fragment), field(), row(line) }` callbacks as the third
`CsvParser` argument to consume field events. This mode returns no row arrays and
emits text in fragments of at most 2049 UTF-16 code units, so callers can spool
arbitrarily large text fields. Empty fields still emit `field()`; blank rows emit
only `row(line)`. Supply bounded input chunks and drain any queued callback work
before the next `push()` to maintain backpressure. Field and character limits
still count the entire field. Event mode supports
text quoting modes 0, 1, 3 and 5; numeric conversion modes 2 and 4 use the row API.
Callbacks must not reenter or dispose the parser.

The `safe-bash-csv-engine/sniffer` subpath exposes `sniff(sample, step, profile)`
for bounded control samples. The default `csvkit` profile preserves the existing
six-delimiter CPython 3.14 heuristics; `python39` uses unrestricted ASCII
frequency candidates and the pinned Unicode 13 word classification. The result
uses Python dialect field names. `decodeSniffUtf8(bytes, signature, signal)`
preserves UTF-8 `errors=ignore` sampling without changing strict payload decoding.

Profile `utf8-sig-permissive-v1` uses fatal UTF-8-sig decoding, comma/quote defaults, optional tab override, single Unicode-scalar dialect characters, escape, doublequote, initial-space handling and quoting modes 0–5. CR, LF and CRLF count physical lines; quoted cells retain their newline code points. Skipped physical lines precede parser numbering. Blank records are empty arrays, unclosed quoted EOF is accepted, characters after a closing quote become unquoted content, and trailing escape at EOF inserts LF. These are explicit candidate rules, not a certification of every Python 3.9 CSV edge case. NUL is retained in either input transport: csvkit file iteration's NUL stripping is an open deviation. Compression remains unqualified. This reader does not claim RFC4180 strictness.

Closed inclusive ranges and decimal ASCII numeric selectors (with ASCII numeric whitespace) are supported; exact nonnumeric names precede ranges, first duplicate name wins, and names are not trimmed. Open/reversed ranges and non-ASCII numeric syntax are unqualified. Resource limits default to `Infinity`; configure finite limits in the invocation allocation/work ledger as needed. Explicit `Infinity` disables a quota.

`CsvDialect.profile: "utf8-sig-strict-v1"` selects strict quote closure/EOF and NUL rejection without changing the default permissive profile. Dialect options are captured at parser creation. Unsupported quoting modes/profiles fail explicitly. `CsvParser.dispose()` releases pending fields and closes the parser; `CsvBudget.dispose()` closes its ledger.

`resolveColumns(selection, headers, budget)` uses the separate `csvkit-2.2.0-ascii-v1` candidate selector contract: colon/hyphen ranges, open endpoints, descending empty ranges, zero origin and ordered inclusion/exclusion. Unknown individual exclusions are ignored and invalid ranges fail; release-specific open-range defects are preserved. The legacy `selectColumns()` contract stays unchanged. Unicode integer grammar and full Python compatibility remain unqualified.

`CsvBudget` accounts input, decoded UTF-16 bytes, output, retained allocations, peak retention, pattern bytes, set entries/storage, arguments, cells, scanned cells and work. `fieldBytes` limits UTF-16 storage; `dialect.fieldCharacters` independently limits Unicode characters. `dialect.encoding` accepts UTF-8-sig (default), UTF-8, ASCII and Latin-1; quoting modes 0–5 are supported. Modes 2 (NONNUMERIC) and 4 (STRINGS) convert nonempty unquoted fields to float text and reject nonnumeric text. Mode 5 (NOTNULL) preserves nonempty fields as text. Null and empty cells both use empty strings in the text-row API and CSV output. Async consumers call `budget.checkpoint()` between bounded chunks to yield by work count, independently of clock progress. Retention conservatively accumulates allocations without reuse; parser and writer charge appended UTF-16 units linearly, while field limits still check the complete field size. All limits are invocation-local. There is no recursion, worker queue, host I/O, ambient encoding/locale, network or executable fallback.

`budget.accounting` returns an immutable snapshot of quota usage. Disposal clears current retention while earlier snapshots preserve their values; observed counters cannot reset the internal ledger.
Input admission counts the actual byte-view length without reading a producer-defined `byteLength` property.

The `safe-bash-csv-engine/text-decoder` subpath exposes the incremental UTF-8 and UTF-8-sig codecs plus the shared CSVkit single-byte codecs for file consumers (ASCII, Latin-1, Windows-1250 through 1256, CP437/737/850/852/857/860/861/863/865/866/874 and Mac Cyrillic/Greek/Latin2/Roman). `PythonTextDecoder` preserves Latin-1 control bytes and distinguishes invalid input (`PythonTextDecodeError`) from unknown encodings. Codec names accept Python aliases and punctuation normalization, including `cp65001`, `UTF 8 SIG`, and `ISO 8859-1`; unregistered spellings such as `utf8-sig` are rejected. Feed bounded chunks and keep filesystem/storage ownership in the caller.
