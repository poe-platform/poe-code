---
title: Uint8Array hexadecimal conversion
---

# Validated gap

Uint8Array.fromHex, Uint8Array.prototype.toHex and setFromHex were missing.
The first targeted run produced 14 failures and four TypeError controls (1.33s).
Installed Node 22 and Node 24.14 do not expose these native methods, so expected
results are derived from the [ECMAScript Uint8Array algorithms](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-uint8array.fromhex),
not from a nonexistent native oracle.

Implement the three concrete Uint8Array methods in their own globals module;
leave shared typed-array methods shared. Install them before intrinsic-state
baselines, and register the static method identity for snapshot restoration.
Do not make the methods available on Uint8ClampedArray or other numeric kinds.

Accept only primitive strings containing an even number of ASCII hex digits.
Encoding is lowercase. Static construction ignores its this value and subclasses.
For setFromHex, reject odd length before writing, preserve successfully decoded
prefix bytes before a bad pair, and do not parse beyond destination capacity.
Validate receiver kind before input type, then bounds before decoding. Use actual
view dimensions, not guest-shadowed length properties.

Bound loops by the step budget, decoded arrays by element/data limits, and
encoded output by string/data limits. Verify mixed-case and invalid text,
partial writes, capacity, brands, bounds, method descriptors and public
dump/restore identities. Run selective tests, lint/types, the actual harness
with screenshot inspection and a Node 18 built-SDK probe. Commit and push this
cohesive extension separately, then monitor releases while continuing work.

Base64 methods remain separate work, as do Float16Array, BigInt arrays, DataView
and the other recorded JavaScript gaps.

Focused validation completed: 1,397 tests passed, one skipped, across 68 files
(27.44s), including all 27 new hex tests, typed-array families, intrinsic
retention, legacy inventories, camera traces and snapshot/replay paths.

TypeScript and ESLint passed after narrowing the validated receiver's buffer
type. The actual harness passed after 70 uncached workspace build tasks
(60.874s) and root stages; its screenshot was inspected. Node 18.18.0 built-SDK
conversion and public dump/restore passed without native hex APIs. No model
calls were made. GitHub API connectivity briefly timed out, then recovered;
the open-issue search returned no matching hex issue.
