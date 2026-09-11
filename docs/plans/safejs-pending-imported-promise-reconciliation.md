# Pending imported Promise reconciliation prototype

Status: isolated, unqualified; not in main. The committed settled-Promise repair
does not support checkpointing a newly encountered still-pending host Promise.
The original isolated capture regression failed on the missing capability before
this prototype. Camera reliability remains the immediate integration priority.

Directory: `/tmp/safejs-promise-depth.bKyGJi`. Do not confuse this with the camera
allocation candidate or the deferred frozen-wrapper experiment.

## Current design

- Replay data may encode a branded imported pending Promise as
  `pending-imported-promise`, only when an explicit capture option is enabled.
- Canonical graph references and the Promise-only memo preserve aliases.
- Decoding requires an explicit pending-Promise resume callback and rejects
  contradictory state/outcome fields. Provider invocation is queued until graph
  initialization and validation have completed.
- Validation uses a never-settling local placeholder and does not call the
  external provider. This path still needs explicit side-effect-order tests.
- HostCallJournal derives a reconciliation identity from the canonical parent
  call ID and graph node. Existing proof validation checks identity and source.
- A successful proof replaces the serialized pending node with its settled
  status/outcome. A completed checkpoint then replays without requesting another
  external proof. The original input Promise need not be resupplied.

## Evidence

The initial test checks capture, independent restore, fulfilled reconciliation,
completed replay without another provider call, missing-provider rejection and
wrong-call-ID proof rejection. It passed before this follow-up.

Two new cases exercise an aliased pending Promise with fulfilled and rejected
outcomes. They verify Promise identity, settlement object identity, one provider
call and completed replay with no provider call. All three tests pass (abaf6c).

The first rejection test incorrectly expected an arbitrary native object rejection
to arrive unchanged. It failed during the original execution, before provider
reconciliation: host-bridge intentionally normalizes native rejection reasons
through createHostErrorValue. The control now rejects a native Error and checks
its message and preserved alias identity. No host rejection policy was changed.
The proof uses supported sandbox data with a message field.

## Required qualification before integration

- Multiple distinct pending nodes and cross-outcome aliases; stable identities
  across repeated still-pending checkpoints.
- Rejected proofs, invalid metadata and malformed graphs before external effects.
- Cancellation and disposal while the provider is pending; no late state writes,
  resource leaks or unhandled rejection changes.
- Owned compilation and data/step/string budgets for proof encoding, nested
  returned Promises and rollback on failure.
- The synthetic reconciliation outcome is retained internally but its record is
  not part of ordinary call ordinals: verify retention and disposal explicitly.
- Focused lint/types, replay/capability suites and the maintained full package gate.

No push, tag, release, workflow dispatch or issue closure during the release hold.

## Disposal prerequisite

The pending prototype's qualification exposed an independent existing journal
lifecycle gap: reconciliation can invoke a provider or accept its proof after
disposal, and an outstanding provider wait is not released. The isolated fix and
red/green evidence are recorded in safejs-host-reconciliation-disposal.md.
Keep this prerequisite separate from pending-Promise format support when porting
or committing. The expanded disposal/journal/pending selection passes 25 tests,
and TypeScript passes; this does not complete the broader pending-node checklist.

Five new codec validation controls in the pending prototype prove that a later
invalid graph entry prevents all provider calls and rolls back imported-Promise
memo entries, contradictory pending status/outcome metadata is rejected before
reconciliation, and aliases in a valid graph request one provider proof. These
and the three existing public pending-Promise cases passed: eight tests across
two files (d1b7b5). Runtime source was unchanged for this qualification. This
does not validate all nested-proof budgets, cross-outcome aliases or repeated
still-pending checkpoints; retain those remaining requirements.

## Current-baseline prototype

The newer candidate `/tmp/safejs-new-promise-capability.KGfWqD` now contains the
pending-node extension on top of the committed scheduling and refined disposal
repairs. Before editing, SHA-256 checks confirmed its host-call.ts and
replay-data.ts matched main exactly (f7eaa1). The three public pending capture
regressions all failed there with MissingReplayCapabilityError (0f1730).

Ported only the pending-node codec/reconciliation behavior, retaining scheduling
IDs for pending declarations and their later settled replacements. Header
validation/reservation includes both kinds. Pending provider reactions use the
current cancellation-aware journal; the older prototype must not overwrite it.
An omitted createReplayEncodingContext import caused the first port's three
failures (6ee12e); adding the required import corrected that implementation
mistake. The ten-test run covering public pending cases, cross-outcome aliases,
repeated pending checkpoints and existing settled host replay passed (0df76c).
Candidate TypeScript passed (ad3cbb).

New cross-outcome coverage keeps two distinct pending nodes, shares one across
two input outcomes, requires two unique reconciliation IDs and replays the
completed result without another provider. Another case checkpoints a replay
while its provider is still pending, then confirms the next provider receives
the identical request identity. These are focused controls, not exhaustive
proof of every nested graph or resource lifetime.

Expanded the capture test to input, synchronous host return and asynchronous
host return. The first host variants omitted the required load capability and
correctly failed admission (1bbd65); that was a test setup error, not a runtime
bug. Restores now supply a replacement loader that throws if invoked, proving
the capability is rebound without repeating the original host operation.
All five public cases passed (e18dfa), including fulfilled/rejected aliases,
completed replay without another provider, missing-provider rejection and
mismatched-proof rejection.

Combined candidate qualification is running as session 75770 across eleven
files, including five malformed-graph controls, scheduling validation, disposal,
context and public cancellation. Scoped lint is session 91753. Main runtime is
unchanged. Nested-proof budgets/ownership, pending-specific cancellation and
late outcomes, broader callbacks, maintained build and full package gate remain
required before integration. No push or release.

The combined candidate run completed: all 62 tests across eleven files passed
(67deb6), report `/tmp/safejs-pending-scheduling-qualification.json`. Scoped lint
passed (fc3bcb). Two additional public pending-specific cancellation tests then
passed (85dfac): abort before provider response rejects promptly, and either a
late fulfillment or late rejection cannot resume guest effects. These tests
cover observable cancellation, not native-GC retention or proof-budget limits.
The new cancellation file has not yet been included in scoped lint. Main runtime
remains unchanged; the prototype is not committed or delivered. Next qualify
proof encoding/retention limits and rollback, then broader callbacks and the
maintained build before considering main integration.

## Nested reconciliation proofs

After main's independent allocation repair 4098d92b4 was applied to the
candidate, all 40 pending/checkpoint/cancellation/proof-budget/retained-callback
tests passed (5f00ac). The candidate values.ts byte-matched main (652725).

A new proof-created-Promise case exposed a stall (307de5). Stage instrumentation
confirmed original capture/completion succeeded and the first replay failed to
reach its inner checkpoint. The provider ran while replay-data decoding was
still constructing the parent input Promise. Creating the new imported Promise
could consume the recorded parent scheduling identity before its registration.
Deferring provider invocation to a Promise reaction after synchronous graph
restoration fixed this case (c18a2c), without changing provider async-local
context or relaxing timeout limits. Diagnostics were removed. The regression
now uses an event-loop sentinel and abort cleanup to expose missing progress
without leaving the test hanging until its five-second timeout.

The completed-checkpoint variant then failed deterministically (8db72a): replay
requested a new provider outcome and returned 3 instead of the observed 2.
New pending Promises encoded inside proof results were not registered in the
journal's imported-Promise memo, and their serialized nodes remained pending
after native settlement. The candidate now stages new memo entries until proof
encoding succeeds, records them with their canonical graph IDs, and refreshes
pending nodes from captured immutable settlements before snapshot serialization.
Scheduling identities survive conversion from pending to settled nodes.

Both nested pending/completed variants and existing public/checkpoint cases
passed: nine tests across three files (c70cab). Main remains unchanged. Candidate
TypeScript is session 33857 and scoped lint is 23010; collect terminal results.
Earlier full qualification predates these two changes and must not be reused
as if it covered them. Still required: refreshed broad compatibility, native
build/import qualification, nested future-settlement budget/ownership checks,
encoding-failure rollback and full maintained package qualification.

Candidate TypeScript passed (75a85f), and scoped lint passed (eb229f). A fresh
fifteen-file compatibility run now includes both nested-proof cases together
with pending budgets/cancellation, malformed graphs, scheduling validation,
all retained callbacks and journal lifecycle/context controls. Report target:
`/tmp/safejs-pending-nested-qualification.json`. Keep candidate source fixed
until this run terminates; do not treat earlier passing runs as its result.

The fresh fifteen-file run ended with 89 passes and three failures (ce4ff0),
all in the proof-budget rollback controls. After allocation rejection, the
restored pending wrapper's captured state held a snapshot error for SandboxError.
The new unconditional refresh incorrectly promoted that internal reconciliation
failure to snapshot failure. The candidate now tracks only new Promises encoded
from successful proofs in a WeakSet and refreshes those; originally restored
pending nodes still settle exclusively through validated reconciliation.
Failed proofs therefore retain the pending serialized node for another attempt.
This refinement is running as 40133 across budgets, nested proofs, public pending
cases and pending cancellation. The 89-pass run is not a green qualification.

The focused refinement run passed all 14 tests across four files (3d1ff0),
including all three previously failing rollback controls. The WeakSet refinement
still needs a fresh full compatibility selection, types and lint. No main source
integration, maintained candidate build or full package success is claimed.

The refreshed fifteen-file compatibility run passed all 92 tests (2a7e37),
report `/tmp/safejs-pending-refined-qualification.json`. Candidate TypeScript
passed (90d37b); scoped lint is session 16635. These checks use the candidate's
prior Promise allocation implementation. Main is independently replacing its
duplicate Promise allocator after three failing regressions; see
safejs-promise-allocation-unification.md. Do not conflate that repair with this
snapshot feature or claim the candidate already contains it.

Candidate scoped lint passed (b0e516). Main's independent Promise allocator
repair was committed as 74f834f68 after 107 tests, scoped lint and the maintained
build/native imports passed. That exact promise.ts diff has now been ported to
the candidate, so the earlier 92-test result predates its current source.

New public future-settlement budget controls found two failures (0c08ed): a
proof-created pending Promise later resolved with 129 characters under a
128-character limit, or 65 array elements under a 64-element limit, and guest
execution completed. Both boundary controls passed. The first failure reporter
expanded the whole run snapshot; the test now projects only status/return value
or error for a readable diagnostic, without changing its assertions or limits.
The same two over-limit cases still fail after the allocator port (eba2f2).

Source inspection points to the intrinsic SandboxPromise path in
awaitSandboxValue: its completion callback forwards the result directly, unlike
the non-Promise path that uses resolveSandboxValue with a budget. Validate that
independent await path on main before implementing a fix. The public pending
feature must not be integrated while this reproduced future-settlement bypass
remains. Its next checks also include ownership, encoding rollback, refreshed
compatibility and maintained full-package qualification. No release or push.

## September 10 main integration qualification

The independent await-budget repair is committed locally as 2cae77b5a. With
that repair included, the isolated candidate passed 96 tests across 16 files
(`/tmp/safejs-pending-await-qualification.json`). Current main then reproduced
all five public checkpoint failures before the feature was applied (256f0e).
The pending implementation and seven regression files are now integrated into
the working tree. The identical 96-test selection passed on main (27f9ac),
including scheduling, cancellation, proof budgets, future settlement limits,
nested pending/completed checkpoints, and retained callback controls.
Scoped lint passed (d8bb75). The maintained selected-workspace closure passed
all 23 builds and five fresh native ESM import checks (bec2c4).

Two additional fulfilled/rejected proof encoding-failure controls passed in
the isolated candidate (47e752). They verify that encoding a new pending
Promise followed by an unencodable closure does not modify the persisted graph,
and that a fresh journal can retry the checkpoint successfully. These tests
have been transferred to main for qualification. No additional runtime repair
was needed for those controls. README now describes pending reconciliation.

The two encoding-failure controls also passed on main (d8e06c). Full maintained
package qualification is running in session 41633, with JSON report target
`/tmp/safejs-pending-integrated-full-results.json`. Keep runtime and test source
fixed while it runs; poll the existing handle instead of restarting the suite.
Full maintained package qualification remains required. Focused passes and a
successful build do not establish JavaScript completeness or resolve the camera
timeouts. No commit of this feature, remote delivery, or release is claimed yet.

## Main gate terminal result

Session 41633 is terminal failure (1c33d0). The authoritative JSON report
`/tmp/safejs-pending-integrated-full-results.json` contains 28,792 passed,
16 failed and 47 skipped across 1,289 files (c1c914). Twelve failures concern
ISO month locale formatting, two concern native Promise own-property admission,
one is the 128-draw completed replay case, and one is an independent string-split
case. The latter two report STACK_TRACE_ERROR and took 7422/7611ms respectively;
their timing suggests deadline failures but requires explicit diagnosis.
All 11 camera cases passed; the slowest sandbox batch took 4125ms. This is not
a camera reliability fix. All new pending-feature regression files passed.

The feature's local commit can record its scoped green qualification together
with this explicitly non-green full gate. It does not resolve these sixteen
failures or include the isolated property-capability and replay allocation
repairs. Continue those repairs separately. Pushes and releases remain held.
