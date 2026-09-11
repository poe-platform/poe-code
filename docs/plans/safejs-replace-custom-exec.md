---
title: Regex replacement custom exec and observable results
---

Fifteen initial failures established that replacement bypassed custom exec,
positions, captures, named groups, getter effects, and callback ordering.

Collect all global exec results before replacement callbacks. Read each result's
length, match text, position, captures, and groups in order; clamp positions and
ignore overlapping substitutions only after computing them. Preserve dynamic
exec lookup, non-callable fallback, empty-match advancement, and callback context.
Use observable flags for regexes that override relevant properties.

Extend substitution parsing for named groups. Box primitive groups once per
result, preserving getter receiver identity. Missing groups and captures expand
to empty strings; null groups reject string substitution but pass through to
functional replacers. Keep callback-produced strings literal.

Native Node 22 differs from the specification in two tested cases: it rereads
match zero after index for functional replacers, and misses indexed keys in
primitive named groups. Explicit tests follow
[RegExp replacement](https://tc39.es/ecma262/#sec-regexp-prototype-%symbol.replace%)
and [GetSubstitution](https://tc39.es/ecma262/#sec-getsubstitution) instead.

Budget tests enforce termination, capture-count bounds, retention of collected
results during later calls, and string-expansion limits before another group
getter. A failing receiver-identity test established the need for actual boxing.
No limits or timeouts were increased.

Validate via maintained safe-js unit tests, focused native/specification tests,
changed-file lint, package types, selected workspace build, and this harness pair
with screenshot inspection. No capabilities or agent spawns.

Remaining separate work includes actual RegExp prototype symbol methods,
matchAll and split species construction, custom exec in resulting iterators,
advanced regex grammar, and wider intrinsic prototype and snapshot support.

Next confirmed constructor gaps: RegExp(regex) incorrectly returns the original
when regex has Symbol.match=false or a different constructor. Native returns a
new regex in both cases. A regex-like object with Symbol.match=true, source='a',
and flags='i' matches 'A' natively after RegExp(pattern), but not in SafeJS.
