---
title: Generator intrinsic prototypes and borrowed iterator methods
---

# Generator intrinsic prototype and method-receiver gaps

Read-only probes and a separate native-oracle regression file validate missing
default iterator-symbol methods, unstable next identity, receiver-insensitive
borrowed methods, absent per-function prototype objects, ignored replacement
function prototypes and the incorrect AsyncGenerator string tag.

This file and its tests were added after generator-own-property full
qualification and the selected build completed. They are not included in that
passing test count or atomic commit.

Implement the actual intrinsic graph: each generator instance inherits its
generator function's prototype object, whose parent supplies stable next,
return, throw and toStringTag descriptors. Sync and async generators inherit
their respective iterator protocol bases. Preserve shared intrinsic identities,
portable snapshots, receiver brand checks, method metadata, overridden prototype
behavior and execution budgets. The sync base must be shared with Array
iterators; do not invent a separate incompatible Iterator prototype.

Native inspection confirms GeneratorFunction.prototype and
AsyncGeneratorFunction.prototype are ordinary objects, not callable functions.
Each generator function's own prototype descriptor is writable, non-enumerable
and non-configurable. A generator function prototype object has no own
constructor property. Dynamic source constructors remain a separately declared
code-evaluation boundary; never expose host Function through the graph.

Additional isolated native probes after the shared Function foundation confirm:
the generator instance prototype is selected before default-parameter evaluation.
For `function* f(x = (f.prototype = {changed: true})) {}`, `f()` inherits the old
prototype even though parameter initialization replaces `f.prototype` during
the call. The current createGeneratorClosure initializes parameters before
creating the generator wrapper, so capture the selected prototype before that
initialization rather than looking it up when the wrapper is finally created.
Bound generator functions have no own prototype, inherit the specialized
generator-function prototype object and thus see its shared prototype property;
the original function still determines the generated instance's prototype.

Native descriptor probes also confirm next/return/throw are writable,
non-enumerable and configurable, with length 1. The shared generator prototype's
constructor is the corresponding non-callable function-prototype object and is
non-writable, non-enumerable, configurable. That object's prototype and
toStringTag descriptors have the same flags. The source constructor stays behind
the existing capability boundary. Async-generator invalid receivers return a
rejected Promise (TypeError), not a synchronous throw; parameter-initialization
errors at an async-generator call do throw before an iterator is returned.

Implementation uses shared sync/async generator prototypes, specialized
non-callable generator-function prototype objects, per-function instance
prototypes and stable receiver-checked methods. The sync iterator base is the
existing Array iterator base; async generators share an AsyncIterator base.
Portable intrinsic identities cover both graphs and their methods. Legacy
source/prototype execution keeps its existing implicit generator projection.

Expanded qualification started with 26 red native-oracle cases. Installing the
graph exposed the missing inherited Iterator tag accessor and incorrect
for-await fallback for explicitly linked synchronous generators; both received
additional failing tests. The Iterator tag setter uses the native distinct-object
receiver rule and creates an ordinary own data property. Metadata on the shared
symbol iterator method also needed explicit intrinsic retention registration:
its mutation-budget test failed while the async counterpart passed.

Two further tests proved the selected instance prototype was dropped from
accounting while default parameters replaced the function's prototype: a
10,000-character retained value disappeared, leaving only eight measured units.
Retain that selected prototype through parameter initialization, releasing it
in finally whether initialization succeeds or throws. Direct heap restoration
tests verify function/instance prototype and borrowed-method identities without
reexecution, alongside pending-effect mutation and frozen-prototype replay.

The Promise import-policy file remains a separate unresolved exclusion. Include
all generator-intrinsic tests in full package qualification for this change.
Iterator global/helper methods and dynamic source constructors are not supplied
by this graph change; dynamic host constructors remain inaccessible.

Focused qualification passes all 48 new tests. The preceding four-file cohort
passed 136 tests before adding the final three legacy/cleanup controls. Scoped
ESLint and TypeScript pass. There is no matching open GitHub generator issue to
close; the validated gaps are tracked here and in their native-oracle tests.

The first full run completed with 17,490 passes, two failures and 41 skips.
Both failures were the maintained contextless Object.fromEntries generator
adapter checks: explicit generator prototypes no longer matched the private
implicit-iterator route. Add a lazy asynchronous protocol adapter with real
descriptor reads, receiver binding, cached next, dynamic closing and result
property reads. Do not restore a bypass that ignores overridden public methods.
The expanded three-file adapter cohort passes 122 tests, including overrides,
getters, custom factories and closing after invalid entries. Pending effects
during default parameters also preserve the preselected prototype on replay.
There are now 54 generator-specific cases; rerun full qualification with all
of them included after this integration fix.

Final full package qualification passed 17,498 tests with 41 declared skips,
509 passing files and one skipped file in 221.99 seconds. The only exclusion
was the two unresolved native-Promise import-policy cases. All 54 new generator
cases and the previously failing direct-adapter timing tests are included.
Scoped ESLint and TypeScript passed after the integration fix.

The selected build passed all 23 dependency-closure tasks and four native ESM
smoke tests. After full qualification and that build were terminal, a separate
five-case bind prototype-order regression file was added and reproduced five
failures. It belongs to the next atomic improvement, is not part of this commit
or its passing test count, and must be fixed before including it in the next
full qualification.

The actual harness passed and its screenshot was viewed after 70 uncached root
build tasks (61.415 seconds). A subsequent compatibility review added direct
heap controls. The first older-shape check passed; no fix was made from that
suspicion. Extending the current-shape test to call the restored generator
function did reproduce two failures: newly created instances lost their
prototype. Two more failures covered the intrinsic fallback with a null public
prototype and no intrinsic heap reference. Restoration had created the function
before lazily initializing its realm, capturing an absent prototype family.

Initialize the realm before restoring a current generator function. Distinguish
its native nonconfigurable prototype property from older admitted generator
property shapes, which must not gain an undeletable property during hydration.
Keep intrinsic initialization lazy for other restored values. Old heaps with an
intrinsic reference and restored ordinary factories that create new generators
are passing controls; the latter needed no additional code change. There are
now 60 generator-specific tests. Repeat full qualification, build and harness
checks after this restoration fix. Explicitly exclude the five uncommitted
next-task bind cases alongside the two unresolved Promise-policy cases.

The post-restoration full run passed 17,504 tests and 41 declared skips in
509 passing files and one skipped file, 226.53 seconds. All 60 generator cases
are included. Only the two pending files named above were excluded. Scoped
ESLint and TypeScript passed after the restoration change.

The post-restoration selected build also passed all 23 dependency-closure build
tasks and all four native ESM smoke tests.

The post-restoration real harness passed and its refreshed screenshot was viewed.
That final screenshot route completed 70 uncached root build tasks in 61.568
seconds before bundling and running the CLI.
