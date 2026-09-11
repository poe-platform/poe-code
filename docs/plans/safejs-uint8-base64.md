---
title: Uint8Array base64 conversion
---

# Validated gap

All 33 initial tests failed because the three Uint8Array base64 methods were
absent. Implement fromBase64, toBase64 and setFromBase64 against the
[ECMAScript algorithms](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-frombase64).
Cover RFC encoding vectors, both alphabets, padding, strict unused-bit checks,
ASCII whitespace, bounded reads and writes, and errors after valid prefixes.

Read options through guest property access in specification order; validate
receiver bounds after getters can resize or detach its buffer. Do not coerce
input strings or enum options. Preserve intrinsic identities in public snapshots.
Bound scanning, output strings, temporary decoded arrays and backing allocation.

Run focused typed-array and snapshot tests, TypeScript and lint, then this real
harness pair with screenshot inspection and a built-SDK probe on Node 18.
The harness does not spawn models and does not prove model behavior.
Commit and push this atomic extension independently; monitor publication while
continuing the remaining Float16, BigInt array, DataView and language gaps.

Validation so far: 1,114 tests passed and one skipped across 54 focused files
(27.19s), including all 67 base64 cases, typed-array operations, intrinsic
retention, camera traces and snapshot paths. Valid encodings are additionally
compared with native Buffer over lengths 0–256 and all byte values; invalid
decoding expectations come from the specification, not Buffer's permissive
decoder. TypeScript and focused ESLint passed. No matching open GitHub issue
was found. The preceding hex commit published SafeJS 0.1.362 while this work
continued; its CLI workflow remained in progress.

The actual harness passed after 70 uncached workspace build tasks (60.906s)
and root build stages; its screenshot was inspected. The Node 18.18 built SDK
passed base64 conversion and public dump/restore without native base64 APIs.
No model calls were made. Existing staged safe-bash changes were preserved.
