# CSV byte-stream engine

Read selected CSV cells and serialize rows without native tools or external runtime dependencies. This private engine supports safe-bash command workspaces; applications use their safe-bash command exports.

`CsvParser.push(bytes)` and `end()` return decoded rows with physical parser line numbers. `selectColumns()` retains selector order and repeated positions. `serializeRow()` writes comma/LF and converts each embedded CR to LF. `generatedHeaders()` uses a..z, aa, bb, cc.

Profile `utf8-sig-permissive-v1` uses fatal UTF-8-sig decoding, comma/quote defaults, optional tab override, single Unicode-scalar dialect characters, escape, doublequote, initial-space handling and quoting modes 0/3. CR, LF and CRLF count physical lines; quoted cells retain their newline code points. Skipped physical lines precede parser numbering. Blank records are empty arrays, unclosed quoted EOF is accepted, characters after a closing quote become unquoted content, and trailing escape at EOF inserts LF. These are explicit candidate rules, not a certification of every Python 3.9 CSV edge case. NUL is retained in either input transport: csvkit file iteration's NUL stripping is an open deviation. Other codecs, quoting 1/2, compression and Sniffer inference are unqualified. This reader does not claim RFC4180 strictness.

Closed inclusive ranges and decimal ASCII numeric selectors (with ASCII numeric whitespace) are supported; exact nonnumeric names precede ranges, first duplicate name wins, and names are not trimmed. Open/reversed ranges and non-ASCII numeric syntax are unqualified. Selectors are bounded by the invocation allocation/work ledger.

`CsvDialect.profile: "utf8-sig-strict-v1"` selects strict quote closure/EOF and NUL rejection without changing the default permissive profile. Dialect options are captured at parser creation. Unsupported quoting modes/profiles fail explicitly. `CsvParser.dispose()` releases pending fields and closes the parser; `CsvBudget.dispose()` closes its ledger.

`resolveColumns(selection, headers, budget)` uses the separate `csvkit-2.2.0-ascii-v1` candidate selector contract: colon/hyphen ranges, open endpoints, descending empty ranges, zero origin and ordered inclusion/exclusion. Unknown individual exclusions are ignored and invalid ranges fail; release-specific open-range defects are preserved. The legacy `selectColumns()` contract stays unchanged. Unicode integer grammar and full Python compatibility remain unqualified.

`CsvBudget` accounts input, decoded UTF-16 bytes, output, retained allocations, peak retention, pattern bytes, set entries/storage, arguments, cells, scanned cells and work. Field limits are UTF-16 storage bytes rather than native character units. Retention conservatively accumulates allocations without reuse; parser and writer concatenation charge the growing intermediate length. All limits are invocation-local. There is no recursion, worker queue, host I/O, ambient encoding/locale, network or executable fallback.

`budget.accounting` returns an immutable snapshot of quota usage. Disposal clears current retention while earlier snapshots preserve their values; observed counters cannot reset the internal ledger.
Input admission counts the actual byte-view length without reading a producer-defined `byteLength` property.
