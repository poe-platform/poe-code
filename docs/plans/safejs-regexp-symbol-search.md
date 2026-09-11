---
title: Generic RegExp Symbol.search protocol
---

Thirteen native comparisons failed because RegExp.prototype[Symbol.search]
was absent. The tests cover metadata, regex and borrowed receivers, getters and
setters, raw index identity, null results, negative zero, object cursors, and
exception ordering. A primitive-receiver control already passed.

Follow the [ECMAScript search algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-prototype-%symbol.search%).
Check the receiver before coercing input, read the previous cursor without
coercion, reset unless it is positive zero, execute through RegExpExec, then read
and conditionally restore the cursor before reading the result index. Execution
errors skip restoration. Setter failures propagate before result-index getters.

Reuse the sandbox property setter and descriptor reads for ordinary objects,
guest functions, and branded regexes. Retain the input, converted string,
previous cursor, and execution result through guest hooks; release on every
completion. Expose the callable with the required name, length, and descriptor.
The former custom String.search path uses the same algorithm, eliminating its
regex-only duplicate.

A further low-budget test reproduced unaccounted data attached to the exposed
intrinsic method. Intrinsic registration now tracks guest method records as
well as the prototype and constructor, deduplicating shared identities. The
method payload, saved-cursor, and execution-result retention tests use fixed
6,000-byte rejection and 14,000-byte success controls.

Validate with maintained SafeJS unit tests, focused protocol/cursor tests,
changed-file lint, package types, selected workspace build, and this real
capability-free harness with screenshot inspection. The other four RegExp
symbol protocols, species construction, and portable custom prototypes remain
unfinished work.
