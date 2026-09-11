---
title: Shared callable function prototype and invocation methods
---

# Validated function prototype dependency

Generator functions need the common function prototype to retain call/apply/bind
when their specialized prototype chain is installed. Current read-only probes
show Object.getPrototypeOf an ordinary function is null, repeated call reads
produce different functions, and invocation-method metadata is missing.

Implement a shared callable prototype with stable call/apply/bind/toString
methods, correct metadata/descriptors, mutation visibility, ordinary Object
inheritance, budgets and snapshot identities. Preserve lazy own name/length and
constructor-prototype properties ahead of inherited metadata. Keep legacy
execution semantics and host-closure boundaries intact.

Existing security tests require Function and native function constructors to
remain inaccessible. Preserve that boundary: the constructor property must not
leak host Function or accidentally inherit Object as the function constructor.
Dynamic source evaluation is not authorized by exposing invocation methods.

This is a separate prerequisite commit. The eight generator-intrinsic tests
remain explicitly excluded from this foundation's full qualification, along
with the pending native-Promise import-policy tests. They are not passes.

Initial qualification reproduced seven failures and six passing controls.
The expanded focused file has 24 cases; a five-file function/property/generator/
coercion cohort passed 124 tests. Two additional red cases identified and guard
against coercion bypassing shared toString/valueOf overrides. Snapshot coverage
includes borrowed intrinsic-method identity and shared-method mutation during a
pending host effect. Budget checks cover retained prototype mutations and the
unchanged two-step bootstrap limit. Legacy source/prototype projection and the
host-constructor boundary have explicit controls.

Separate native-oracle probes still find an absent inherited Symbol.hasInstance
method and rejection of generic array-like arguments by Function.prototype.apply
(the native result is 7; SafeJS reports TypeError for `{0:7,length:1}`). This
foundation preserves the existing array apply route; it does not claim full
Function-family conformance. Specialized async/generator function prototype
chains and these invocation/instance checks remain on the completion inventory.

Full qualification passed: 17,441 tests, 41 declared skips, 508 passing files
and one skipped file in 237.77 seconds. The two exclusions above stayed explicit;
all 24 foundation tests are included. Scoped ESLint and TypeScript passed.

Selected build passed 23 dependency-closure tasks and four native ESM smoke
tests. The actual harness pair passed and its screenshot was viewed. The root
screenshot route completed 70 uncached build tasks in 61.064 seconds. No matching
open GitHub Function.prototype issue was found to close.
