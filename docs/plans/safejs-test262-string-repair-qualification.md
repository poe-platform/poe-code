# Upstream qualification of string argument repairs

## Method

Fetched original top-level Test262 fixtures at revision
`72faf8ec1445c55149615e8b35187830783aba1a` from the tc39/test262 repository.
Parsed YAML metadata and loaded sta.js, assert.js and declared includes in
memory. Ran each fixture in strict mode in a fresh native Node VM context
with a one-second native timeout, then in a fresh SafeJS run with a final
`return true`. No fixture source was rewritten to accommodate the guest.

Negative, async, module, raw and noStrict fixtures would be reported as excluded;
native-control failures would be reported as unqualified. Neither occurred in
this selection. This bounded adapter is not the official Test262 runner or a
full JavaScript conformance result. Nested fixture directories were not selected.

## Results

Runtime is locally committed `d40849585` on Node 22.23.2. All 131 guest fixtures
and their native controls passed, with zero failures, exclusions or unqualified
cases:

| String.prototype directory | Passes |
| --- | ---: |
| startsWith | 21 |
| endsWith | 27 |
| includes | 27 |
| repeat | 16 |
| normalize | 14 |
| padStart | 13 |
| padEnd | 13 |

Tool evidence: 66e079, 475d5d, f7f5fa and 67ee9b. The earlier five failures in
each predicate-search directory and the repeat count-abrupt fixture now pass.

The simultaneous full-package run is independent and remains pending. These
passes do not resolve its historical ISO/Temporal or Promise-admission failures.
No push or release was performed.
