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

## Callable metadata implementation

The parser identity and length repair is separately committed as `0b3e4d7c0`.
For the remaining 32 audited methods, the new regression file first failed all
32 cases (33130), after each native control confirmed the expected descriptor
and bound-function lengths. The implementation adds explicit lengths to 22
Object static methods, two Array statics, three String statics and four Number
predicates, and changes BigInt.prototype.toString from one to zero.

The published [builtin length rule](https://tc39.es/ecma262/2026/multipage/ecmascript-standard-built-in-objects.html#sec-ecmascript-standard-built-in-objects)
excludes optional and rest parameters unless a method specifies an exception.
[BigInt.prototype.toString](https://tc39.es/ecma262/2026/multipage/numbers-and-dates.html#sec-bigint.prototype.tostring)
has only an optional radix and no length exception. Metadata is declared in
the factories, not read from mutable host functions. Invocation behavior is
unchanged.

The focused main-tree selection passed 179 tests in six files (87385), covering
all new descriptor/bind/public-replay cases, parser identity, String factory
coercion, Number predicates, BigInt coercion and intrinsic snapshot mutations.
The isolated candidate is based on `0b3e4d7c0`, staged tree
`407fb40314f3b1879381f5c7891a2216491ca399`, excluding pending realm and weak
reference changes. Its same six-file selection independently passed all 179
tests (18060). The maintained selected build passed 23 tasks and four native
ESM import checks (98319). All 1,280 tracked SafeJS source blobs matched the
private index before and after checks. The built CLI screenshot (b22934) was
visually reviewed: representative Object, Array, String, Number and BigInt
lengths match the declarations. Scoped lint passed all three changed source/test
files (93500). These focused checks do not establish full-worktree conformance.

## Global predicate follow-up

A later built-runtime probe (5d5501) enumerated 53 callable guest globals and
compared their names and lengths with a fresh Node VM. Two comparable globals
still differ: `isNaN.length` and `isFinite.length` are zero in SafeJS and one in
the native control. Five names were unavailable in the VM and were not counted
as matches: Float16Array, SuppressedError, DisposableStack, AsyncDisposableStack
and structuredClone. The earlier audit did not cover these global predicates.

The main-tree metadata regression table now includes both cases. Do not change
the runtime until these tests have been run red. The isolated prototype-origin
candidate and its live full suite (94735) remain unchanged; this follow-up is
not part of that gate.

The added predicate cases failed as expected while the existing 32 passed
(98082). Both factories now explicitly declare length one, without changing
coercion or call behavior. Focused verification runs separately in the main
tree; the full prototype candidate remains unchanged and does not include this
follow-up. The metadata and numeric-predicate selection passed all 82 tests
(3746). Independent build/lint verification is still required before commit.

The independent predicate-only candidate is based on `78b4c7842`, staged tree
`0e8d2418dde82bc39f3a9b1dca59acd529d29755`; no prototype-origin or weak-reference
work is included. All 1,327 tracked SafeJS source/test blobs matched the private
index before and after verification. The selected maintained build passed all
23 tasks and four native ESM import checks (74470). Both focused files passed
all 82 tests (22094). The built CLI screenshot (45319) was reviewed and reports
length one and bound length zero for both globals. Scoped lint passed both files
(63333). These checks do not resolve the separate full-suite type-contract
timeout or prove complete builtin conformance.
