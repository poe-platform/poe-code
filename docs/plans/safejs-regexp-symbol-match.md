---
title: Generic RegExp Symbol.match protocol
---

Eleven initial tests failed because the protocol was missing. The regression
suite checks metadata, native regexes, borrowed object/function receivers,
result identity, global collection, null results, match coercion, cursor
accessors, failed cursor writes, and bounded custom execution.

Use the current [ECMAScript match algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-prototype-%symbol.match%).
Input conversion precedes flags lookup and conversion. Nonglobal calls preserve
the execution result identity. Global calls reset the cursor, collect coerced
matches, and advance empty matches by code point when flags include u or v.
Flags-order and v-mode tests use explicit specification expectations because
older engines instead read global and unicode properties.

Generalize the existing observable matching implementation and use the normal
sandbox property setter for cursor writes. Preserve the default internal path
only when relevant regex descriptors are unchanged, transferring retained
state ownership before entering it. Do not redispatch through String.match's
symbol lookup. No budget limits or timeouts are increased.

Validate with the maintained SafeJS unit route, focused matching/cursor tests,
changed-file lint, package types, selected workspace build, and this real
capability-free harness with screenshot inspection. MatchAll, replace, split,
species construction, and portable custom prototypes remain unfinished work.
