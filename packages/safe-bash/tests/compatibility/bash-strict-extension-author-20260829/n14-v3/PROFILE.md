# N14 exact-invocation diagnostic forwarding

ROOT-authorized private repair, 2026-08-29. Base source9bb91c37, derived37e793ce,
full954 aaabea71 remains historical. Dirac681/684, author636, novel45/48 and N14's
three failures are not rescored. N14 is not proven introduced by9bb.

Production write set: **src/shell/runtime.ts only**. Existing cancellation-state
bookkeeping owns a private weak exact-Promise diagnostic map. No public API,
exports, shared limits or Node code changes. Private diagnostic wrappers remain
internal through outcome selection; only the selected diagnostic is recorded
before unwrapping to the public raw rejection. Caller selection is unchanged.
When runtime observes that exact returned invocation Promise, it consumes the
private record and restores the fatal diagnostic path. It does not infer this
from reason equality, truthiness, a public error class or global poison.

Public invoke still rejects raw0/false/undefined. A handler can consume failure
by catching and returning success. Catch-rethrow or async-wrapper Promise
identities are outside this narrow forwarding rule; they keep ordinary runtime
error policy, not an implicit all-Promise provenance promise. Independent plugin
throws of the same value remain ordinary. Weak records are cleared at runtime
closure and keyed by invocation Promise, not rejection value.

Focused12 protocols (source/installed/moved): exact return0/false/undefined;
raw public invoke rejection observation with transparent return; ordinary throw0;
caught-success; transformed catch-rethrow; async wrapper; callerfalse priority;
registered cleanupfalse after diagnostic0; typed ShellLimitError; and recursive
transparent guards. At most12 identities, with explicit nonpromise-propagation
observations. Every gate has independent finally release; no wait-cycle fixture.
N14's readonly reviewer fixture is hash-bound evidence, never edited.

Validation also retains the current636 author identities (35 extension,67
conditional,50 strict,48 redirection,12 arrays per layout), six type groups,
existing six loaded mutants/restores and two binding refusals, plus one N14
loaded reversion/restoration. Native Bash/Git/engine/private/network/fullgate
remain UNRUN. No coherent Node composition is authorized by this repair.
