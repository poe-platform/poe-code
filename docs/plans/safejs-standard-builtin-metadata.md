# Standard builtin metadata follow-up

A read-only descriptor comparison against Node 22 examined 30 constructors or
namespaces and their direct prototypes (f46eba). It found 36 differences among
matching names; unlike name presence, these compare flags and callable metadata.

## Validated constructor bindings

DataView and SharedArrayBuffer expose writable `prototype` bindings in SafeJS.
Native controls report nonwritable bindings, matching published ECMAScript 2026:
[DataView.prototype](https://tc39.es/ecma262/2026/multipage/structured-data.html#sec-dataview.prototype)
and [SharedArrayBuffer.prototype](https://tc39.es/ecma262/2026/multipage/structured-data.html#sec-sharedarraybuffer.prototype).

Both factories call `materializeFunctionProperties`, which initially creates a
writable prototype binding for constructible guest functions. Their subsequent
`Object.defineProperty` calls replace its value but omit `writable`, preserving
the existing true flag. ArrayBuffer already explicitly sets it false.

Add regression tests for descriptor flags, assignment/Reflect rejection,
unchanged intrinsic identity, allowed prototype-object mutation, subclasses,
proxy invariants and replay. Fix these two factory descriptors, not the common
guest-function default: ordinary guest constructors require writable bindings.

The 16-case native/replay regression file produced 13 failures and three passes
(62928): twelve failures validated descriptor, assignment, defineProperty and
Proxy-invariant differences. The thirteenth separately exposed completed-dump
serialization rejecting a SharedArrayBuffer subclass instance retained in the
top-level scope; fresh construction passed. Both constructor factories now
explicitly set `writable: false`. Focused validation passed 139 cases and retained
the subclass dump failure (32798). A separate six-case reproduction identified
the generic dump guard rejecting supported buffer state. That repair passed
isolated validation and is committed as `ec097d454`; see
`safejs-buffer-public-replay.md`. The combined main-tree selection then passed
all 149 tests (69375).

The descriptor-only candidate is based on `ec097d454`, excluding the pending
intrinsic-parent and weak-reference changes. Its staged tree is
`e4345a35daa6ac8e3ddb1c0a0301b11dfa6f1a31`; isolated snapshot and buffer tests
passed 1,855 tests across 134 files (63559). All 1,324 tracked source/test blobs
matched the candidate tree before testing and again after validation. The
selected SafeJS workspace build passed all 23 tasks and four native ESM import
checks (39772); scoped ESLint passed for both factories and the regression file
(79674). The built CLI screenshot (13595) was visually reviewed: both constructors
report `writable: false` and `replacementAccepted: false`, with successful output.
These are scoped checks, not a claim that the entire pending worktree passes.

## Callable metadata to validate separately

The probe also reported zero lengths for many Object static methods, Array.from
and Array.isArray, three String static methods and six Number static methods.
BigInt.prototype.toString reported length 1 instead of native Node 22's 0.
Check published signatures and explicit length exceptions before implementing
these as a separate atomic change. Do not infer complete metadata conformance
from the bounded comparison or silently copy host-specific surfaces.
