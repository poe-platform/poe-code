# ROOT decisions and observer preparation — additive v2

August28,2026. Original1fe588ee files/seal,32 recipes and all prior results stay
unchanged. Different design848a8eaa/959eff75 supplied78 METADATA checks, not
semantic observations. This addendum overrides only explicitly selected policy.

## Ratified versus pending

ROOT selects `-u0` as the actual effective shared stdin, including ordinary
redirected/forwarded stdin. Other descriptors and -C/-c refuse before builtin
pull/target effects. Explicit-u0 against runtime-known closed fd0 fails before
target effects; arbitrary producer.next failures cannot be pre-detected. Exact
numeric spelling of equivalent zero remains linked to pending count grammar.
Counts, extra operands, UTF8/NUL, origin and clear/publication phases remain
pending observations/final policy. No source/parser/array edits are authorized.

The original phrase “never lease across user code” was too broad. A serialized
record read necessarily awaits trusted host ByteSource.next(). Enforce no extra
shell callback/registered-command/diagnostic execution while holding that lease,
not a promise of host exclusion or preemption. Reentrant producer code that
awaits the SAME cursor would deadlock unless detected/refused; do not claim it
is made safe by a mutex or by aborting the whole parent.

## Exact PRIVATE integration proposal, not an implemented API

Future private input ownership lives in runtime/input, not array state or public
CommandContext. Proposed internal operations (names/signatures are design only):

```
prepareInputOwner(scope, budget, signal): InputOwner
InputOwner.bind(effectiveSource, knownClosed): CanonicalInput
CanonicalInput.view: ShellInput
CanonicalInput.knownClosed: boolean
CanonicalInput.readRecord(storagePlan, delimiter): Promise<Record | EOF>
InputOwner.close(): Promise<void>
```

`prepareInputOwner` registers an idempotent cooperative drain with the owning
InvocationScope BEFORE invoking a raw source iterator/acquisition. A bind to an
existing ShellInput creates only a borrowed view sharing its cursor; a raw bind
creates ONE owned cursor within that exact owning invocation. Rebinding to another
source creates a separately owned cursor, not identity-based sharing. Forward the
canonical view into the terminal context, child IO and nested invocation closure;
do not globally cache ByteSource objects. An independently replaced sibling scope
is not the same stream merely because host code supplies an equal object again.

Mapping to accepted d250 runtime:
- Root234 in shell.ts, redirects1307/1341 and pipeline1020 already own views;
  borrow them, preserving existing lifetime/return and producer-copy semantics.
- dispatch terminal1535 resolves final middleware `context.stdin` before builtin
  dispatch. This is the missing owner boundary for raw replacement. Its existing
  invocation scope, not a mapfile-local wrapper, owns the canonicalization and
  downstream sharing. Preserve ordinary read behavior; do not silently change its
  parser/decoder or create a competing cursor. A future author must explicitly
  freeze any observable raw-terminal normalization change before source GO.
- invokeScoped2251 already owns explicit replacement views; omitted input borrows.
  shebangStage1897 already demonstrates register-before-acquisition; do not lose
  accepted cancellation callbacks, clone rules or cleanup ranking when reusing it.
- knownClosed comes ONLY from effective source identity===closedSource (592), or
  a canonical view's retained private origin. Do not consult a stale descriptor0
  after middleware replaces stdin (redirect reconciles that difference at1264).
  A wrapper around an opaque source does not acquire authority to call it closed.

Record leases retain unread suffix in finally before releasing serialization.
Register owned work/drain before calling next; borrowed completion/-n must not
return the parent. Proposed reentrancy guard carries a private active-operation
token across host next, rejects an attempted nested consumption of that same
cursor rather than queuing a self-dependency, and does not reject unrelated
sibling queueing. Distinguishing nested asynchronous causality from a concurrent
sibling needs an explicit mechanism (for example an invocation-local async token
propagated through trusted producer callbacks); no current public/private API
provides that proof. **This is an open implementation-design choice**, not a
claim that a boolean busy flag solves it. Alternative: explicitly unsupported
same-cursor producer recursion with caller cancellation as escape, preserving
current opaque-input boundary. ROOT should select before product source GO.

Every new record/stage/carry/watch remains under G4A private P, with E_input and
existing post-transfer formatting E separately named. No array-ledger API is
assumed accepted, no new Budget, and no product input allocation is reclassified
by this observer work.

## Additive observation correction

Original N30 has no C3 byte and remains a delimiter-NO-HIT observation. New A01
uses literal C3 A9 bytes and verifies the declared delimiter first byte occurs in
input before native execution. A02–A04 cover exact2147483647/next-index boundary
with one/two records, not large loops. A05–A10 isolate failures with initial/
after target and remaining input snapshots; A11 isolates explicit-u0 closed input.
These11 neutral additions are separate from the original32. No expectations or
native results are supplied. Original32 contain46 static mapfile/readarray calls;
the new11 add11, not57 passes. Prospective launch ceiling becomes43 top-level,
47 declared contexts; total deadline150000ms, other original byte ceilings retained.

## Harness authorization in this phase

ROOT authorizes new observer MODULES and DATA/SYNTHETIC tests only. The preseal
names finite in-memory filesystem, clock and child-driver controls. No real Node
child is needed or authorized; no GNU invocation/version/help/syntax check,
product/array import, private engine, permission probe or old supervisor reuse.
Real driver code can be inspected but is NOT exercised by those controls.
Before any actual oracle run, a different reviewer must inspect exact module
bytes, synthetic receipts, admission/binding protocol, then ROOT must issue an
explicit bound authorization for original32 plus selected additions. Array
acceptance is a PRODUCT prerequisite, not a prerequisite for oracle preparation.
