---
title: Generic RegExp Symbol.replace protocol
---

All thirteen initial tests failed because RegExp.prototype[Symbol.replace] was
missing. Comparisons cover metadata, borrowed objects/functions, captures,
named groups, callback arguments and receiver, result coercion, global
collection before callbacks, accessor-backed cursors, and bounded execution.

Follow the [ECMAScript replacement algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-prototype-%symbol.replace%).
Validate the receiver, convert the input, and convert a non-callable replacement
before reading flags. Collect execution results before invoking replacement
callbacks. Preserve capture and group semantics through the existing expansion
and result-processing implementation. Cursor writes use the sandbox setter.

Generalize the observable replacement routine instead of adding a second
substitution engine. Transfer retained-state ownership before entering the
unchanged-descriptor fast path. String replacement and explicit protocol calls
share the implementation without recursively dispatching the symbol hook.
Keep all existing resource limits and timeout settings unchanged.

Validate via maintained SafeJS unit tests, focused replacement/cursor checks,
changed-file lint, package types, selected workspace build, and this real
capability-free harness with screenshot inspection. MatchAll, split, species
construction, and portable custom-prototype persistence remain unfinished.
