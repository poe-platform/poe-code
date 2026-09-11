---
title: RegExp lookahead assertions
---

All 18 initial native comparisons fail because lookahead is rejected. Add positive
and negative lookahead nodes to the parser, compiled-memory accounting, and matcher.
Assertions preserve the outer cursor, positive assertions expose the first successful
capture state atomically, and negative assertions discard speculative captures.
Repeated enclosing atoms must clear captures inside assertions.

Reference: [ECMAScript CompileAssertion](https://tc39.es/ecma262/multipage/text-processing.html#sec-compileassertion).

Validate native capture/index comparisons, short-input cross-checks, checkpoint
replay, compile/execution limits, the maintained SafeJS tests, lint/types, and the
selected build. Run this real CLI harness and inspect its screenshot before the
atomic commit and push. Continue the remaining regex and JavaScript gaps while
release workflows run; lookbehind, backreferences, named captures, and Unicode
regex mode remain separate open work.
