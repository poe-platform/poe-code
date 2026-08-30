# Measured native gaps — author result

Original immutable legacy94 remains the denominator. Baseline: 45 exact, 43 diagnostic-only differences, 6 status/stdout differences. Final author run: 94/94 exact, 376/376 executions over both original routes/transports. Every before/after byte tuple and repro is in native-gap-closure.json and committed-r3-legacy.json. No expected bytes changed. Independent review is still required.

| Original gap ID | Before differing fields | Final status | Final native comparison |
| --- | --- | ---: | --- |
| outside-string-0 | stderrHex | 5 | exact |
| outside-string-1 | stderrHex | 5 | exact |
| outside-string-2 | stderrHex | 5 | exact |
| outside-string-3 | stderrHex | 5 | exact |
| outside-string-4 | stderrHex | 5 | exact |
| prefix-0-0--c | stderrHex | 5 | exact |
| prefix-0-0--sc | stderrHex | 5 | exact |
| prefix-1-0--c | stderrHex | 5 | exact |
| prefix-1-0--sc | stderrHex | 5 | exact |
| prefix-0-1--c | stderrHex | 5 | exact |
| prefix-0-1--sc | stderrHex | 5 | exact |
| prefix-1-1--c | stderrHex | 5 | exact |
| prefix-1-1--sc | stderrHex | 5 | exact |
| prefix-0-2--c | stderrHex | 5 | exact |
| prefix-0-2--sc | stderrHex | 5 | exact |
| prefix-1-2--c | stderrHex | 5 | exact |
| prefix-1-2--sc | stderrHex | 5 | exact |
| prefix-0-3--c | stderrHex | 5 | exact |
| prefix-0-3--sc | stderrHex | 5 | exact |
| prefix-1-3--c | stderrHex | 5 | exact |
| prefix-1-3--sc | stderrHex | 5 | exact |
| prefix-0-4--c | stderrHex | 5 | exact |
| prefix-0-4--sc | stderrHex | 5 | exact |
| prefix-1-4--c | stderrHex | 5 | exact |
| prefix-1-4--sc | stderrHex | 5 | exact |
| prefix-0-5--c | stderrHex | 5 | exact |
| prefix-0-5--sc | stderrHex | 5 | exact |
| prefix-1-5--c | stderrHex | 5 | exact |
| prefix-1-5--sc | stderrHex | 5 | exact |
| resource-json-0 | status, stdoutHex, stderrHex | 0 | exact |
| resource-json-1 | status, stdoutHex, stderrHex | 0 | exact |
| resource-json-2 | status, stdoutHex, stderrHex | 0 | exact |
| resource-json-5 | stderrHex | 5 | exact |
| resource-json-7 | status, stdoutHex, stderrHex | 0 | exact |
| resource-json-8 | status, stdoutHex, stderrHex | 0 | exact |
| resource-json-9 | stderrHex | 5 | exact |
| resource-json-10 | stderrHex | 5 | exact |
| resource-json-14 | status, stdoutHex, stderrHex | 0 | exact |
| resource-utf8-0 | stderrHex | 5 | exact |
| resource-utf8-1 | stderrHex | 5 | exact |
| resource-utf8-2 | stderrHex | 5 | exact |
| resource-utf8-3 | stderrHex | 5 | exact |
| resource-filter-0 | stderrHex | 5 | exact |
| resource-filter-1 | stderrHex | 5 | exact |
| resource-filter-2 | stderrHex | 5 | exact |
| join-zero-arity | stderrHex | 3 | exact |
| join-two-arity | stderrHex | 3 | exact |
| generator-error-after-output | stderrHex | 5 | exact |
| generator-error-before-typecheck | stderrHex | 5 | exact |

## Remaining boundaries

| Item | Current state | Treatment |
| --- | --- | --- |
| All49 original native gaps | No measured differences in unchanged94 | Author result, not independent closure |
| 2039 small author-native vectors plus15 scan-boundary vectors | All exact in the final author test run | Generated vectors overlap other cohorts; not full jq coverage |
| split(regex; flags) overload | Still explicitly unsupported in the virtual subset | Not a native profile exception; no unrelated regex feature expansion or flag stub |
| Huge native string multiplication exploration | One 2-second native timeout, no semantic result | Preserved separately; not a pass, not deleted from history |
| Thirty unchanged test failures | 22 original +4 acceptance labels +3 arity regexes +1 host-sink contract conflict | Unapplied proposals, not a green canonical suite |
| Wider jq language/options/builtins | Not exhaustively implemented or compared | No full jq, full shell, superiority or project-completion claim |
