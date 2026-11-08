# local-a cleanup v2 — bounded author handoff

Baseline ec74e14df6bb7caf6b1be59fd44b027d7240101e. New runtime SHA256
bff86fcfc7f59b4f0a42a304edf72b9b69027b508c532b1401bea0628d201d2b.
Only the generic indexed-local branch changes; exact authenticated baseline
prefix/suffix equality was checked before PURE execution. No parser, ERE,
arithmetic, scalar-local, flags, public API or epoch/refund change.

## Source changes

Saved-state preparation, operation creation and hold acquisition now run inside
one ownership boundary. Every acquired branch cleanup is attempted independently.
The explicit first-primary presence bit preserves undefined/null/false/0/object
identity; subsequent cleanup values use the existing invocation failures channel,
at most four values for this branch. No wrapping or new public error API.

A previously typed saved record is borrowed, not overwritten/reprepared or
discarded on a later admission failure. A newly prepared same-frame scalar-local
record is discarded on prepublication failure, without deleting the locals entry.
Once publication attaches the saved record to locals, cleanup does not discard
that restoration record. Publication effects and already-consumed ledger work
are not rolled back. Shadow, operation and hold cleanup still run once.

## Actual evidence and qualification

One file-based PURE helper, one captured Git DATA child, zero Shell/runtime class
imports, Workers, compiler/build/install/native calls. Exact trusted branch text
is narrowly type-erased and executed with doubles. SOURCE-SEAL.json records the
actual fragment, every erasure and baseline/candidate identities. This is not
actual private owner cleanup, atomic publication, restoration or budget proof.

RESULT.json retains **11/12**, not a green rewrite. C05 loops later failure cuts;
its unconditional discarded=1 assertion fails for the injected store.publish
throw. The unchanged callback attaches saved to locals before calling publish,
so the new cleanup deliberately retains that attached restoration record
(discarded=0). The raw result did not record per-cut names; this attribution is
source-derived, not a second observed run. No expectation or original result was
changed. A different reviewer should isolate that publication boundary before
acceptance. All raw-falsy/all-cleanup-failure controls pass, as do partial prepare,
create and hold admission, borrowed typed state and postpublication rejection.

The existing prepareVariable helper has its own create/hold and cleanup sequence
outside this authorized branch. This patch does not claim to repair internal
partial acquisitions that never become visible via typedSavedVariables. Any
broader helper repair requires ROOT ownership approval; no such edits were made.

The earlier independent HOLD, PIPE75/3 and R17 remain historical. No coherent
build or real local-a/R17 acceptance is claimed. Independent Lorentz delta review
and subsequent separately authorized coherent build remain required.

## Capture scope

Instruction/source reads used tool captures as context, separate from helper
evidence. Helper owner files and Git stdout/stderr were opened before their
fallible work; child status0/signalnull was retained. Owner helper exited1 solely
for the ordinary C05 assertion. No retry or new group. Raw baseline capture,
source seal, result, stdout and empty stderr are preserved. Known explicit tool
commands and the one Git child are not a universal tool-shell/process census.
