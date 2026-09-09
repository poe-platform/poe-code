# Borrowed dynamic constructor owner realms

Baseline `e501b4f33`: four native differential tests showed borrowed Function,
AsyncFunction, GeneratorFunction and AsyncGeneratorFunction constructors reading
the caller's global marker instead of the constructor owner's marker.

Pass the intrinsic constructor's budget through the dynamic compilation callback
and select its saved global evaluation context. Share the existing weak context
registry with eval; do not expose either script's private lexical scope.

The first implementation passed the generator cases but exposed a mismatched
compilation-owner handoff for ordinary and async closures. Closure invocation
must inherit the caller's compilation only when it belongs to the closure's
budget; otherwise retain its own context. Budget generation and active-owner
checks remain enforced by acquireCompileOwner.

Seven regression cases cover all four dynamic constructor kinds and ordinary,
bound and Proxy construction with separately replayed caller and owner realms,
replaced Function bindings, isolated global writes and inaccessible private
locals. All seven plus 15 running-state/budget-owner tests passed after the
handoff fix. Initial failing runs remain evidence, not successful gates.
The expanded dynamic/eval, persistent-realm, accounting and reentry route passed
486 tests across 40 files. Scoped lint, TypeScript and diff checks passed.
The final eight-case regression file also checks constructing a generated
function with new, and passed with scoped lint. The full snapshot route passed
1,700 tests across 127 files. The maintained build passed 23 workspace builds
and four fresh-import checks. These scopes overlap; no new whole-package gate
was run for this change.
Four built-SDK owner-global probes passed, one per dynamic constructor kind.

No push, release or issue closure while the release hold is active.
