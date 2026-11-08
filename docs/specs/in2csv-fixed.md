# in2csv fixed-width conversion

Reference: csvkit 2.2.0, source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Runtime/dependency/locale/driver identities remain frozen in
`docs/csvkit/reference-profile.json`, profile
`darwin-cpython-3.14.2-csvkit-2.2.0`. New executable observations are in
`docs/csvkit/in2csv-fixed-reference.json`; their environment includes
`PYTHONIOENCODING=utf-8`, which sets the reference default input encoding.

The existing `in2csv` executable and typed SDK use the same domain converter.
`-f fixed` requires `-s`; a nonempty schema also implies fixed format.
Schemas use the common injected text opening, encoding and compression path.
They are CSV, with literal required headers `column`, `start`, `length`;
additional headers are ignored. Duplicate headers select the first occurrence.
Schema integer failures and missing cells report the enumerated schema row
number starting at 2, even when a quoted schema field occupies multiple
physical lines. Start conversion precedes column/length access.

Only the first schema data row determines position mode: start 1 makes every
start one-based; every other value makes all starts zero-based. `--zero` does
not affect this decision. Integer conversion accepts the frozen Python decimal
digits, signs, whitespace and digit separators, and reports the CPython
4300-digit conversion limit. Invalid integer diagnostics truncate the Python
representation to 200 Unicode codepoints, including a potentially omitted
closing quote. Negative starts and lengths and arbitrary-size
indices remain valid. Slices use Unicode codepoints and calculate the endpoint
with exact integers before clamping. Fields may overlap or appear out of order;
short records simply produce shorter or empty fields. Python `strip()` applies
after slicing, including the frozen Unicode whitespace profile.

Skip-lines consumes physical input lines before schema parsing and output.
Borrowed stdin splits at LF and retains its original CR and NUL characters
through slicing. Named text files translate universal newlines and remove NUL
during iteration, matching csvkit's LazyFile. The Agate-compatible writer then
normalizes embedded CR in string fields to LF. It writes schema names and
trimmed field strings directly: numeric leading zeros and null-like strings
survive; line numbers, no-header-row and input delimiter do not alter these
rows. The common output BOM still applies. Empty schema fields produce empty
CSV records, including one header record. Empty data retains the schema header.
The upstream streaming converter returns an empty string after its own writes;
the command adapter reports status 0 without a second inference/writer pass.

Data iteration awaits every output write, preserving backpressure within the
existing bounded codec admission prefix. Sources stay under Runtime's
synchronously registered cooperative cleanup. Cancellation retains reason
identity and finalizes admitted iterators. No process, implicit filesystem,
network, database or Python fallback is used by the product converter.

Unqualified verbose Python tracebacks, corrupt compression diagnostics and
missing injected compression/codec capabilities remain explicit blockers.
This qualification does not establish complete parity for the other formats
or the entire fourteen-command suite; existing skipped/todo cases are blockers.
