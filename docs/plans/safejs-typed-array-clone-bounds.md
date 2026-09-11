---
title: Structured clone typed-array bounds
---

# Validated mismatch

For all nine supported typed-array kinds, shrinking a resizable backing buffer
below a fixed view's bounds and cloning that view succeeded in SafeJS. Native
JavaScript throws DataCloneError. Initial tests produced nine failures and one
passing in-bounds zero-length control (1.18s).

The [HTML structured serialization algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)
requires rejecting out-of-bounds views before serializing their backing buffer.
Use the existing captured native typed-array bounds validation before the
structured-clone storage-copy path. Translate its TypeError to a DataCloneError
DOMException. Do not change ordinary host copying or snapshot/replay restoration:
those paths deliberately preserve temporarily out-of-bounds view layouts.

Expanded regression checks exposed a related projection gap: native DOMException
names survived guest catch, but their numeric code was omitted. Preserve that
code using the captured intrinsic getter for actual DOMException instances.
Do not read overridden code accessors or broaden arbitrary Error metadata
transport. A replacement-getter regression guards this boundary.

Verify all supported kinds, fixed/length-tracking/zero-length invalid views,
detached storage, valid zero-length views, exception name/code, unchanged source
storage and revival after regrowth. Run focused clone/typed-array/snapshot tests,
lint and TypeScript, then the actual harness and inspect its screenshot.

This does not add a guest DOMException constructor or fix every structuredClone
error category, transfer options or unsupported platform object. Those remain
separate completeness work. Commit and push this validated fix atomically and
monitor publication without blocking the next issue.

Focused verification: 1,651 tests passed across 72 files (29.02s), covering
the 14 new regressions, typed arrays, copy boundaries, exceptions and source
errors, intrinsic errors, and primary/replay snapshot paths. The separate native
DOMException-code gap was reproduced before the projection change (12 failing
name/code cases while 1,370 controls passed).

TypeScript and ESLint passed. The actual harness passed for all nine kinds
after 70 uncached workspace build tasks (60.374s) and root build stages; its
screenshot was inspected. Node 18.18.0 built-SDK detached-view rejection and
public dump/restore preserved DataCloneError name and code. No models were
invoked. No matching open structuredClone issue was found to close.
