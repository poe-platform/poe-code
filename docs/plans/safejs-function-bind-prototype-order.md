---
title: Function.bind prototype selection order
---

# Validated Function.bind prototype-order gap

A read-only probe against built main 385543e26 and an isolated native Node
v22.23.2 VM produced different results. Start with an ordinary function, save its
prototype, and replace its length property with a getter that changes the
function's prototype to a new object. Bind the function and compare the bound
function's prototype to the saved original: native returns true; SafeJS false.

The current methods/function.ts reads length/name before the local bind helper
checks hasExplicitSandboxPrototype and gets the target's prototype. Native bind
selects the prototype before those metadata reads. Capture the initial prototype
and preserve it through reentrant getters, including null/custom/generator
prototypes and any required temporary budget retention. Validate with failing
tests before changing code; qualify and deliver as a separate atomic improvement.

The generic apply array-like gap was independently rechecked in the same session:
native passes object entries 0/1 and length 2 to the target; SafeJS throws its
array-only TypeError. That remains a separate invocation improvement, not part
of bind ordering or the generator prototype commit.

Five native-oracle tests now reproduce the bind ordering failure for length and
name getters, an initially null prototype, and sync/async generator functions.
They were added only after the generator graph's full suite and selected build
completed. Receipt: /tmp/poe-safejs-function-bind-prototype-order-red.log.
No matching open GitHub bind-prototype issue was found.

Nine cases failed before implementation: the five oracle cases above and four
budget checks for retaining the initial prototype during length/name getters,
including release after an abrupt completion. Two additional passing controls
cover bound construction and metadata getter order. The implementation captures
the initial link and temporarily retains explicit non-null prototypes, releasing
them in finally. Call/construct forwarding remains unchanged.

Snapshot qualification discovered a separate unsupported bound-function heap
case. Three failing reproductions remain in function-bound-snapshot.test.ts for
the next atomic fix; they are not counted as passes for this change. The existing
two host-Promise property policy tests also remain unresolved and excluded.

Manual validation: run the focused invocation tests and lint/typecheck, then the
maintained SafeJS workspace unit route excluding those two pending files. Build
the selected workspace closure. Run this paired harness through the screenshot
command and inspect its image for successful call and constructor checks.

Qualification receipt: 83 focused invocation tests passed; scoped ESLint and
TypeScript passed. The maintained workspace unit route passed 17,515 tests with
41 declared skips in 218.07 seconds (510 passing files, one skipped). The five
pending cases described above were explicitly excluded, not counted as passes.
The selected workspace build completed 23 dependency-closure builds and all four
native ESM import checks. The actual paired CLI harness passed; its screenshot
was opened and inspected. The root screenshot route rebuilt 70 tasks uncached
in 61.023 seconds before running the harness.
