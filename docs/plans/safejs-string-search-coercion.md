# String search argument coercion gap

## Upstream evidence

Strict in-memory Test262 qualification at revision
`72faf8ec1445c55149615e8b35187830783aba1a`, with parsed YAML metadata, original
sta/assert/includes and fresh native Node 22.23.2 VM controls, reports:

| String.prototype directory | Guest passes | Guest failures |
| --- | ---: | ---: |
| startsWith | 16 | 5 |
| endsWith | 22 | 5 |
| includes | 22 | 5 |
| repeat | 15 | 1 |

All native controls passed; there were no metadata exclusions or unsupported
harness cases (cc9450, 576983). This is not the official Test262 runner or full
string conformance. The three search methods fail the position, Symbol search,
search-string conversion, Symbol.match getter and RegExp-rejection fixtures.
Repeat fails `return-abrupt-from-count.js` and needs a separate count-coercion
repair.

## Independent reproduction

Minimal guest probes (749256) return false instead of TypeError for Symbol and
RegExp search values. A throwing search toString produces an unrelated
TypeError instead of its thrown value. The new uncommitted
`string-search-coercion.test.ts` has 21 failing and six passing cases (3f2b45),
covering all three search methods. It records receiver/match/search/position
ordering, callable-object arguments and RegExp Symbol.match overrides.
Matching results in the six passing cases alone do not prove their internal
protocol is correct.

## Cause and repair requirements

`methods/string.ts` callStringMethodBody reaches native String(args[0]) and
native numeric conversion helpers without guest argument coercion. The
method body's generic function-argument rejection also rejects callable
objects with valid custom string conversion. It does not apply IsRegExp for
these three search methods.

Use the guest property/coercion protocol in specification order: receiver
string conversion, IsRegExp (including Symbol.match), search ToString, then
position conversion with the endsWith undefined-position distinction.
Preserve abrupt completion, Proxy hooks, symbol rejection and ignored extra
arguments. Reuse native substring matching only after guest coercion has
completed. Add direct SDK and checkpoint checks before claiming full repair.

The main runtime remains unchanged under full-package gate 94973. Tests added
after its launch are independently checked, not assumed to be in that gate.
No string repair, push or release is claimed yet.
