# Iterator and disposable-stack constructor default realms

Baseline `50369f5be`: six cases failed for foreign newTarget.prototype values
of 7 and null across Iterator, DisposableStack and AsyncDisposableStack.
Three custom-object prototype controls passed.

Select the intrinsic prototype from the newTarget function's realm before
allocating the instance, using the existing function-realm lookup. Retain
Iterator's abstract-constructor check and stack state initialization.

Iterator expectations are compared with separate native VM contexts. The host
does not implement either disposable stack; their identity expectations follow
ECMA-262 OrdinaryCreateFromConstructor in the respective constructor algorithms:
https://tc39.es/ecma262/multipage/control-abstraction-objects.html

The expanded 20-case regression file covers primitive and custom prototypes,
bound-class and Proxy targets, independently replayed target realms with replaced
global bindings, revocation during prototype lookup, and actual LIFO disposal
through foreign stack methods. All passed in a 71-test, six-file focused run.
The broader Iterator/resource route passed 412 tests across 23 files (overlapping
the focused run). Scoped ESLint, TypeScript and diff whitespace checks passed.
The maintained selected-workspace build passed all 23 builds and four fresh
import checks. No new full package gate was run for this focused change.
Three built-SDK probes passed for foreign bound-target prototype selection.

This does not establish whole-package conformance or cross-realm snapshot graph
support. Release hold remains in effect: no push, release or issue closure.
