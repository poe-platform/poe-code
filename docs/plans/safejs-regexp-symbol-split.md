---
title: RegExp species splitting
---

Implement the validated missing RegExp Symbol.split protocol, including its
required sticky matching support. Initial native comparisons failed in 12 of
13 cases. Sticky execution also failed because the flag was rejected.

Follow the [ECMAScript RegExp.prototype Symbol.split algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-prototype-%symbol.split%): input coercion,
species selection, observable flags, sticky construction, limit conversion,
cursor-controlled execution, and uncoerced captures. Preserve resource accounting
across guest accessors and callbacks. Unicode advancement is supported for custom
species matchers; native Unicode regex compilation remains a separate open gap.

Validate native comparisons, the maintained SafeJS tests, focused lint/types,
the selected workspace build, and this real harness via a viewed CLI screenshot.
Commit and push the atomic protocol improvement, then monitor publication while
continuing the JavaScript compatibility work.
