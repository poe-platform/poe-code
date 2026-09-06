---
title: RegExp named captures and references
---

Implement named groups across parsing, compilation accounting, execution, match
metadata, replacement strings/callbacks, and checkpoint replay. Validate the gap
with native comparisons before changing runtime code.

The installed Node version rejects duplicate names even in disjoint alternatives.
Use the current ECMAScript MightBothParticipate rule for those cases, with explicit
expected results: duplicates in separate alternatives are allowed; duplicates that
can participate together are syntax errors. Named references select the participating
capture, including after repetitions clear prior captures.

References:

- [Current early errors](https://tc39.es/ecma262/multipage/text-processing.html#sec-patterns-static-semantics-early-errors)
- [TC39 duplicate named captures](https://github.com/tc39/proposal-duplicate-named-capturing-groups)

Implementation requirements:

- Decode and validate Unicode identifier names, including Unicode escapes and astral names.
- Count named groups for numbered references, including forward references.
- Preserve legacy identity escaping of `k` when no named groups are present; reject unknown named references when named groups exist.
- Produce null-prototype groups objects with undefined unmatched properties, safe `__proto__` keys, and aliases between indices.groups and indexed capture pairs.
- Preserve named data in exec, match, matchAll, split, replace, and replaceAll.
- Extend compiled-memory and execution accounting; validate checkpoint replay.
- Follow the SafeJS harness skill: add the real harness pair, run the CLI screenshot check, and inspect the image after unit/lint/type/build checks pass.
- Commit and push the completed atomic improvement, leaving unrelated staged work untouched; monitor release publication while continuing remaining gaps.
