---
title: Module namespace validation
---

# Module namespace exotic semantics gap

Validated with the built SDK after Float16 delivery, while Reflect was pending:
`import * as ns from "api"` with host module exports `{x:1}` produces an extensible
ordinary null-prototype record. Its `x` descriptor is configurable; `Reflect.set`
can replace the export. A native data-URL module exporting `const x=1` is
non-extensible, has `[object Module]`, exposes a non-configurable writable data
descriptor, and rejects Reflect.set without changing x.

This is a broader module representation gap, not solely a Reflect operation bug.
Before implementation, add exact failing tests for host and guest module
namespaces, export ordering, live bindings, descriptor compatibility, assignment,
deletion, prototype operations and public snapshot restoration. Inspect existing
host transport policy and preserve alias identity and capability isolation.
Do not equate Object.freeze with module exotic semantics: export descriptors
remain writable even though the namespace's [[Set]] always returns false.

Implementation locations confirmed: `modules/registry.ts` builds imported
namespaces with createBindingRecord/Object.assign. Low-level restoration in
`snapshot/restore.ts` has a separate createModuleNamespace doing the same thing.
Both paths need the same namespace semantics and portable identity. Do not fix
only Reflect.set: assignments, descriptor operations and restored objects must
agree. Source-module declarations found under lint/module-registry are lint
metadata; inspect actual runtime linking rather than assuming they execute.

Specification checked: https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-module-namespace-exotic-objects
Exports are sorted by UTF-16 code-unit order, not localeCompare or ordinary
integer-key ordering. [[DefineOwnProperty]] permits compatible descriptors and
SameValue redefinitions, but rejects accessors, configurability, non-enumerability
and writable:false. [[Set]] always returns false, including with a different
receiver. The null prototype is immutable and the namespace is non-extensible.

Initial regression table: nine failures and one native-comparison pass against
178946188 (1.34 seconds). Direct Node 22/24 probes also found native deviations:
integer-like namespace exports are reordered numerically, and writes through a
namespace prototype to a different receiver succeed. Those two cases now use
explicit specification expectations rather than copying native behavior. The
native data-URL probe was confirmed with util.types.isModuleNamespaceObject.

Implemented a privately identified namespace proxy with non-extensible storage,
immutable null prototype, compatible definition checks, sorted export keys and
assignment rejection. Interpreter assignment, super assignment and Reflect.set
respect namespaces encountered in prototype chains. Namespace factories are
shared by import resolution and low-level restoration.

Initial runtime tests then exposed missing replay-input support before execution.
Replay data and portable guest heaps now have explicit module-namespace nodes;
allocation registers identity before decoding exports, preserving cycles.
The initial ten regressions passed, followed by 40 namespace identity/replay
tests. A structuredClone regression failed before namespace rejection was added
to both clone paths. Public replay, SDK returns, low-level cyclic snapshots and
registry/run controls then passed (84 tests).

An empty export-name regression found both registry and low-level restoration
silently discarded that valid export. Removed those filters after the failing
test; prototype-sensitive names remain own exports. Malformed heap-node tests
reject duplicate names, non-string names, missing values and extra fields.
TypeScript passed before this last focused change. Full package validation,
final lint/build and the real paired harness remain required before delivery.

The expanded focused route passed 121 tests across six files (13.55 seconds),
and focused ESLint passed on all changed TypeScript files. There is no matching
open GitHub namespace issue to close. The implementation is held fixed during
the remaining build/harness, older-host SDK and full-package checks.

The real paired harness passed after 70 uncached build tasks (60.715 seconds)
and root suffix stages, and its screenshot was inspected. It performs zero
agent spawns and does not establish model behavior. Node 18 built SDK checks
passed for namespace metadata, lexicographic ordering including empty names,
shared identities, assignment rejection and public replay. The complete package
route is running, excluding only the unresolved Promise-import policy probe.

Final maintained package result: 19,063 tests passed, 41 optional tests skipped,
594 files passed and one skipped (322.03 seconds). No source or test files changed
during this run. The only explicit exclusion was the separate Promise-import
policy probe, not counted as a pass. Lint, TypeScript, the uncached build, Node 18
SDK replay checks and the inspected real harness passed before delivery.

An additional raw root `tsc --noEmit` diagnostic (not the maintained typecheck)
failed across repository test fixtures. The new namespace test's own diagnostics
were isolated and fixed: runtime success assertions now narrow result unions,
the native data-URL import uses a string variable, and the low-level snapshot
fixture explicitly types its boundary value. Its own TypeScript diagnostics are
now zero; maintained `npm run lint:types` and focused ESLint also pass. These
test-only typing corrections do not change runtime implementation or assertions.
