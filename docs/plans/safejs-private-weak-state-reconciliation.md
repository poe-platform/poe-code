# Private weak-state dependency reconciliation

Commit the existing private weak-reference, weak-collection and finalization
state modules, their shared realm-symbol registry declaration and deterministic
finalization-state tests. These modules provide the brands needed to reject
weak-state objects at copy boundaries. This reconciliation changes no runtime
behavior in those modules; the structured-clone guard is a separate fix.

The state code keeps object targets weak, indexes collection entries through
weak references, and queues finalization work rather than invoking guest cleanup
from a native GC callback. Tests control collection notices instead of depending
on actual GC timing. The finalization tests cover cancellation, duplicate
notices, disposal, cleanup errors, weak targets/tokens and restored dead targets.

Node 22 qualification includes these nine finalization tests and eleven existing
weak-collection accounting tests, alongside the structured-clone selection:
21 files, 208 passing tests total (6fbbda). The accounting tests exercise still-
uncommitted values.ts work and are not included in this dependency commit.
Package TypeScript no-emit checking and focused lint pass.

This is not full weak-API delivery: public constructors, symbol-registry wiring,
accounting and snapshot/replay integration remain partly uncommitted. Arbitrary
weak symbol support still depends on host runtime capabilities; Node 18 cannot
be declared fully conformant on this evidence. Other known weak-lifetime and
snapshot limitations remain as documented in the package README.

Local dependency commit only, preserving unrelated staged Safe Bash changes.
No push, release or issue closure under the release hold.
