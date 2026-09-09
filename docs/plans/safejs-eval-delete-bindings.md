# Deletable eval declarations

Fresh native/source comparisons reproduce three mismatches: new non-strict
direct-eval var declarations, function declarations and repeated var declarations
remain non-deletable locally. Native JavaScript returns true from deletion and
subsequent typeof returns undefined. An existing ordinary function var remains
non-deletable in both runtimes. Lexical eval isolation and several completion
controls also agree; do not change those behaviors speculatively.

[EvalDeclarationInstantiation](https://tc39.es/ecma262/2026/multipage/global-object.html#sec-evaldeclarationinstantiation)
and [Declarative Environment DeleteBinding](https://tc39.es/ecma262/2026/multipage/executable-code-and-execution-contexts.html#sec-declarative-environment-records-deletebinding-n)
define creation/deletion semantics. Check the full algorithms before editing.

Current Scope cells have kind, value and silentImmutable metadata but no
deletability attribute. A repair must distinguish newly created eval bindings
from existing var/parameter bindings, preserve lookup and closure behavior after
deletion, and carry the attribute through snapshots with validation. Do not make
ordinary var, lexical or parameter bindings deletable. This is separate from the
pending ReferenceError stack commit and belongs with the uncommitted eval work.

Added native-comparison tests for creation, redeclaration, deletion through a
captured scope and deletion followed by recreation. Five cases fail and three
controls pass (session 38202). Implementation not yet changed.

JSON-checkpoint closure tests independently reproduce two failures (eval-created
var/function deletion), with the existing ordinary-var control passing (session
41436). Scope frame capture/hydration and guest-heap validation must preserve
the distinction. The seven demonstrated failures remain open.

## Initial repair and stronger checks

Scope var cells now carry optional deletable metadata, preserved in frame
capture/hydration and validated on snapshot import. Eval declaration hoisting
marks only newly created bindings; existing var/parameter bindings retain their
attributes. Identifier deletion removes the resolved cell and invalidates its
accounting roots. Ordinary declarations remain non-deletable. Legacy eval block
functions use the same creation flag.

The original eleven runtime/recovery tests pass. Expanded scope, eval declaration,
global declaration and catch recovery checks pass all 96 tests across eight files.
Package TypeScript passes. Snapshot controls reject non-true deletion flags.

A stronger compound-assignment probe exposes another failure: after eval creates
x, `x += (delete x, 2)` throws ReferenceError locally. Node 22 recreates a global
property, including when another global x already exists. Declarative Environment
SetMutableBinding specifies recreating a missing non-strict binding in its original
environment; determine the Reference/assignment semantics before choosing a fix.
The expanded runtime matrix currently has one failure and thirteen passes.
Native controls now use fresh VM contexts to avoid shared global-property effects.
This follow-up remains unresolved; no lint, atomic commit or full-gate success is
claimed for the initial deletion repair. Keep it with the pending eval work.

The normative SetMutableBinding algorithm explicitly covers a deleted binding
during assignment. A dedicated specification-based test reproduced the incorrect
update of an outer global (3 instead of 9); it does not use Node's conflicting
result as its oracle. Resolved declarative assignments now recreate a missing
non-strict var binding in the captured scope and throw for strict references.
Revalidation and focused lint are underway. Suspended assignment references whose
binding was deleted before a yield still need dedicated recovery validation.

## Resolved assignment and pattern recovery

Three paused-generator assignment controls (=, +=, ||=) pass through JSON
recovery after deleting the captured binding. Array and object destructuring
defaults exposed four further concrete failures: two runtime cases and two
paused/recovered cases all threw for the deleted name (session 74838).

Scope.assignOwnBinding now implements writes to an already-resolved declarative
environment, including missing non-strict binding creation and strict rejection.
Ordinary scope-search assignment retains its separate lookup/object behavior and
shares the existing mutable/immutable write checks. Interpreter assignments and
prepared destructuring references use the resolved-environment operation, so
neither accidentally falls back to an outer binding after deletion.

The final targeted eval/recovery cohort passes 106 tests across nine files.
Another 236 tests across seventeen files pass, including pattern defaults,
generator assignments, scope aliases and frames, retained-data accounting,
deletion releasing its value, and deletion preserving another alias to that cell.
Whitespace checks pass and protected SafeBash staging retains its patch identity.

The earlier TypeScript/lint session 98851 passed before this last shared-write
change. Final TypeScript and focused lint are now running in session 97073;
do not attribute the earlier lint pass to these newer files. No atomic commit,
full-package gate, push or release is claimed for this eval follow-up yet.

Session 97073 has now completed with exit 0: final package TypeScript and focused
repository-configured lint pass for the shared-write implementation and all its
new tests. The repair still depends on the larger uncommitted dynamic/eval work;
its isolated local delivery must not silently include unrelated weak-collection
or host-Promise policy changes.
