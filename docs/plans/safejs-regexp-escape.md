---
title: RegExp.escape
---

Implement the missing RegExp.escape static method using ECMAScript's specified
encodings. The installed Node 22 lacks the method, so use explicit encoding
vectors from the specification and native pattern round trips in every mode.

Reference: [RegExp.escape and EncodeForRegExpEscape](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp.escape).

Requirements:

- Reject non-string values without invoking conversion hooks, including boxed strings.
- Hex-escape leading ASCII letters/digits, other punctuators, and relevant Latin-1 whitespace.
- Backslash-escape syntax characters and slash; use the five control escapes.
- Unicode-escape other whitespace and unpaired surrogates; preserve valid astral code points.
- Expose a writable/configurable, non-enumerable, non-constructor method with name escape and length 1.
- Charge per-code-point work and output string size; reserve temporary output data before growth and release it on success or failure.
- Verify checkpoint replay, safe pattern concatenation, method replacement/deletion, exact budget boundaries, and fatal guest budget behavior.

Follow the SafeJS harness skill with an inline schema and async frontmatter entry
point; no spawns or external capabilities. Run package tests, lint, types, selected
build, then screenshot validation with image inspection. Commit/push this atomic
API improvement to main and keep release monitoring independent of subsequent work.

Full JavaScript compatibility remains incomplete; this method is not a completion claim.
