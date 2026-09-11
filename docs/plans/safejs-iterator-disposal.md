# Iterator disposal protocols

## Validated gaps

A built-runtime comparison with Node 24.14 found Iterator.prototype[Symbol.dispose] and the async-generator inherited Symbol.asyncDispose method missing in SafeJS. They are separate delivery steps, each with its own tests, commit, push, and release tracking.

## Synchronous iterator disposal

Follow [Iterator.prototype Symbol.dispose](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype-%symbol.dispose%). The method reads return for each call, invokes a callable method with the original receiver and no arguments, ignores the result, and returns undefined. Missing/nullish methods are no-ops. Borrowed receivers need no iterator brand. Nullish receivers, non-callable methods, getters, and method exceptions retain normal property-access and call behavior.

Seven new tests failed before implementation; the eighth negative control already reported TypeError when the method itself was absent. All eight pass after installing the intrinsic on the shared iterator prototype, including generator cleanup through DisposableStack, descriptors, inherited array-iterator identity, and an escaped-method JSON snapshot after prototype mutation.

Focused verification passed all 1,831 tests across 53 iterator, generator, interpreter, and disposable-stack files. Changed-file lint passed. The selected workspace build passed its 23-workspace closure and four fresh-import checks. A Node 18.18 built-runtime probe closed a suspended generator through DisposableStack and confirmed its completion state.

The async iterator method must return a promise, await the return method's result, preserve failures, and survive snapshots while pending.

## Async iterator disposal

All seven initial tests failed before implementation. The implementation installs Symbol.asyncDispose on the common async iterator prototype. It reads and invokes return with the original receiver, translates failures into rejected promises, resolves the result using the intrinsic Promise identity, and fulfills with undefined. The result-discarding reaction has an intrinsic identity so pending disposal can be serialized without an unrepresented native continuation.

Initial tests pass for async-generator cleanup through AsyncDisposableStack, descriptors, borrowed receivers, rejection identity, same-constructor Promise handling without reading then, and pending JSON snapshot restoration without repeating return. Additional checks cover thenable assimilation, a throwing constructor getter, and pending thenable snapshots.

Focused verification passed all 1,848 tests across 55 iterator, generator, interpreter, disposable-stack, and pending-promise aggregate files. Changed-file lint passed. The prior test process handle was unavailable after context restoration, so these results come from a fresh completed run. An attempted `basic` reporter failed at startup; the successful run used the maintained default reporter.

The selected workspace build passed its 23-workspace closure and all four fresh-import checks. A Node 18.18 built-runtime probe awaited async-generator cleanup through AsyncDisposableStack and confirmed the generator was closed. These are runtime changes with no CLI presentation changes.

Reference: [AsyncIteratorPrototype Symbol.asyncDispose](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-%asynciteratorprototype%-%symbol.asyncdispose%).
