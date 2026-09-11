# Reject weak private state in structured clones

Four new cases failed before implementation (686620): low-level structured
cloning accepted WeakMap, WeakSet, WeakRef and FinalizationRegistry values.
Each case verifies native DataCloneError rejection, then tests the guest value
directly and nested, with both intrinsic and null prototypes.

Reject the three private weak-state brands before ordinary data copying when
structured cloning is requested. The imports depend on the separately reconciled
private-state modules. No ordinary copy, weak lifetime or cleanup behavior is
changed by this guard.

Node 22: all 208 selected tests passed across 21 files, including the full
filename-selected structured-clone set and the private-state/accounting tests.
Package TypeScript no-emit checking and focused lint pass. All four Node 18.18.2
object-target regressions pass; they do not qualify weak symbols.

Only the three private-state imports, the clone guard, its regression file and
this plan belong in the fix commit. Leave other values.ts changes, public weak
integration and unrelated staged Safe Bash work intact. The broader full-suite
failures and integration work remain open. No full JavaScript completeness claim.
Local commit only under the release hold: no push, release or issue closure.
