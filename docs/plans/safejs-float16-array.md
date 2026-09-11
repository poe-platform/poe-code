---
title: Float16 typed-array validation
---

# Validated Float16Array gap

Against 7c2806092, the built SDK on Node 24.14.0 rejects Float16Array with
UNBOUND_IDENTIFIER. Native execution of the same rounding probe returns
[3, 1.099609375, true, Infinity]. The initial regression also checks typed-view
branding, element width and shared backing bytes. Node 18.18 remains supported;
do not expose the feature only when the host happens to implement it.

Support the full maintained typed-array family behavior, not only construction:
coercion, methods, species/content types, aliasing, exact half-float storage,
resizable and detached buffers, host copying, replay, public and low-level
snapshots, budgets and lint. Use Node 24 native comparisons and Node 18 built-SDK
checks. Keep missing Float16 support separate from intentional capability limits.

Selected dependency: https://github.com/petamoriken/float16, version 3.9.3.
Its constructor and index proxy already implement half-float
storage and host-side methods. Its documented limitations include native
ArrayBuffer.isView and structuredClone because Proxy has no native view slots.
SafeJS would need its own integration for those operations regardless.

Source inspected: src/Float16Array.mjs. It uses a private Uint16Array backing view;
borrowed native typed-array getters cannot read its proxy directly. Do not trust
guest-shadowable buffer/length properties or its cross-version public branding
fallback as a sandbox brand check.

Implementation: prefer the native
constructor where available; otherwise wrap a maintained ponyfill constructor and
record a private backing-view layout immediately, before guest properties can be
added. Keep a strict owned-instance brand and captured backing-view accessors.
Do not silently accept arbitrary external proxy objects. Adapt constructor copy
and set paths involving emulated views so they retain typed-array semantics
(ignore guest iterators, reject BigInt mismatches even when empty, preserve same-
type NaN bits, and correctly snapshot overlapping source storage). Other maintained
methods already use indexed access or raw backing bytes and must be tested too.

The shared constructor registry currently feeds both runtime and lint. Preserve
that single membership declaration and avoid conditional guest feature presence.
Document older-host export limitations honestly; do not substitute Float32Array
storage or claim native ArrayBuffer.isView accepts a proxy outside the sandbox.

Validation so far: initial two tests failed with UNBOUND_IDENTIFIER; after initial
registration, five concrete failures exposed view detection, iterator-sensitive
copies, overlapping set, shadowed source lengths and empty BigInt conversion.
These now pass. Snapshot and host-copy probes then exposed constructor naming
under bundling and the generic proxy rejection guard. The fallback has a stable
name and only privately branded typed views bypass that guard.

Fifteen table-driven expectations were independently executed against native Node
24.14.0. Focused lifecycle/lint/legacy snapshot tests: 94 passed, one optional skip.
BigInt regression coverage also passed (56 tests). TypeScript and focused ESLint
passed. The full SafeJS package route passed 18,987 tests with 41 optional skips
in 310.82 seconds, excluding only the separate unresolved Promise-import probe.
The actual harness passed after 70 uncached workspace build tasks and the root
suffix stages; its screenshot was inspected. This zero-spawn harness validates
language execution, not model behavior. Node 18 built-SDK lint, rounding,
overlapping copies, structured cloning and public snapshot restore passed.
All fifteen comparison cases also passed through the Node 24 built SDK.
Repository-wide `npm run lint` passed: 10,175 configured files linted with zero
errors or warnings, followed by successful root TypeScript and workflow lint.

Publication policy probe confirmed the CLI external needs a root runtime
dependency declaration as well as the SafeJS workspace declaration:
findBundleIssues reported @petamoriken/float16 as undeclared-dependency. Both
manifests now declare the same version range. The maintained full build passed,
and the generated standalone SafeJS manifest includes @petamoriken/float16 at
^3.9.3. Package generation was local validation only, not a local release.
