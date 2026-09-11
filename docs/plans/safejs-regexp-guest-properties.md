---
title: RegExp guest property model
---

# RegExp guest property model

## Reproduction

The initial native differential probe in
`packages/safe-js/src/interp/regexp-properties.test.ts` has 14 failures and one
passing freeze/lastIndex control. Failures cover symbol assignment, named data
properties, own names/descriptors, getters, method overrides, deletion, spreading,
extensibility, and an own source property that must not change regex execution.
Host-export and checkpoint-replay regressions extend the required coverage.

The property model and copy/snapshot extensions are implemented and locally
qualified by the gates recorded below.

## Root cause

`createSandboxRegex` seals an engine wrapper containing kind/source/flags/lastIndex
and private compiled-pattern symbols. `setRegexMember` allows only lastIndex;
the interpreter separately rejects symbol keys. Object descriptor APIs reject
RegExp targets and enumerable/symbol-key helpers omit their properties entirely.
Freezing/sealing currently inspects the wrapper, not a native-like guest object.

## Implementation requirements

1. Separate guest property storage from engine metadata. Keep source, flags,
   brands and compiled patterns inaccessible to guest enumeration and immune to
   guest shadowing. Maintain a real data descriptor for guest lastIndex:
   non-enumerable, non-configurable, initially writable. Engine cursor reads and
   writes must use the same value and honor its writability.
2. Route descriptor lookup, own keys, existence, deletion, setters, defineProperty,
   Object.assign/spread, freeze/seal and extensibility operations through guest
   storage. Preserve strict errors for inherited readonly RegExp properties;
   explicit own source overrides must not replace the engine's source.
3. Resolve own method overrides before the optimized RegExp call path. Existing
   string protocol dispatch must see custom symbol data properties and getters.
4. Include custom property values, symbols, accessor closures and cycles in data
   accounting and retained graph traversal. Do not expose compiled internals or
   native executable hooks to guest code.
5. Extend clone, host copy, replay data, execution snapshots and public dump paths
   consistently. Preserve aliases, descriptors, symbols and extensibility where
   supported. Reject unsupported callable/accessor data explicitly rather than
   silently discarding it. Keep structuredClone semantics distinct from snapshots.
6. Preserve backwards-compatible restoration of existing compact regex snapshots
   and all cursor graph behavior. Validate serialized metadata before restoring it.

## Integration points inspected

- `interp/values.ts`: regex creation, measurement, clone and host export.
- `interp/object-model.ts`: descriptor traversal and data property lookup.
- `interp/interpreter.ts`: optimized calls, property reads/writes and deletion.
- `interp/globals/object.ts`, `interp/globals/object-array.ts`: object operations.
- `interp/methods/regex.ts`: default properties and cursor writes.
- `snapshot/serialize.ts`, `snapshot/restore.ts`, `snapshot/replay-data.ts`,
  `snapshot/dump-format.ts`: graph traversal and serialized representations.
- `snapshot/regex-cursor-data.test.ts`: existing four-boundary cursor graph tests.

## Qualification

Require native differential tests, engine-metadata isolation, host export without
capability leaks, cyclic alias round trips, descriptor/extensibility preservation,
and fatal data-budget controls. Run focused tests before the maintained SafeJS
package suite, scoped lint/types, selected build, and real CLI harness screenshot.
Commit and push this as one coherent property-model improvement once qualified;
monitor publication independently while continuing the remaining JS gaps.

## Remaining broader gaps

Default RegExp prototype graphs and intrinsic symbol algorithms are distinct from
custom own properties. Advanced regex syntax/flags and the remaining string
protocols also remain open; this work must not be described as full conformance.

RegExp accessors execute in the interpreter but are explicitly rejected by data
copy/serialization, consistent with the existing accessor boundary limitation.

## Qualification results

The maintained SafeJS package suite passes 14,087 tests, with 41 skipped. Scoped
ESLint and TypeScript pass. The original compile-policy and EA checkpoint controls
remain unchanged and pass: host-side lastIndex data-property redefinition still
works, and default regex public dumps retain their legacy representation. Custom
guest properties use the extended heap format, with symbol aliases and validated
descriptors. A separate regression verifies the graph-depth limit sees values
reachable only through RegExp guest storage.

The selected workspace build completed (23 builds and four import checks). The
real paired CLI harness passed with zero spawns; its screenshot was inspected.
