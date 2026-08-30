# L02 ownership repair: source, one strict build, pure doubles only

Source commit: 4abbdeec8e34de88ed2cf7bd32be9c06b413c631. Fixture-only syntax correction preseal: 40948d132b8dc628b39eedb3069a9298d9788ff8.

## Scoped result

Only private transport owner.ts/root.ts change; the other10 modules remain individually bound to SOURCES.json (accepted engine72187e5 and transport46611a5b). No Expr, public options, wire envelope, engine, shell/runtime, parser or conditional changes. No actual Worker, matching, Shell, native oracle, network, install or private engine execution.

One strict TypeScript process exited0 with empty stdout/stderr and24 JS/declaration emissions. Strict flags include noUncheckedIndexedAccess and exactOptionalPropertyTypes; skipLibCheck remains explicit. No new negative consumer type process was run. First pure helper exited1 on a generated newline-literal SyntaxError before module execution:0/16 controls, retained. Second version changes only that literal and output filename;16/16 fixed groups pass against actual emitted private owner/root with importer-specific fakeWorker. No third helper or compiler retry.

## Ownership semantics and limits

UNCONFIRMED is an explicit private owner/root state, never RETIRED or CLOSED. A rejected termination with unobserved exit/drain, or incomplete stream enrollment, rejects completion using earlier setup primary, otherwise exact cleanup reason including undefined. The owner retains Worker/waiter/stream references; root keeps active ticket, cancel listener, reservations, session/root/Worker metadata and refuses more work. Known retirement clears the Worker only after exit and stream joins; raw earlier failures still reject close. Caller cancellation at selection outranks setup; no reason-class/equality provenance.

Both stdout and stderr enrollment are attempted after exit-handler setup failure. No production prototype fallback bypasses the injected once fault. The single-fault future fixture allows only the FIRST registration to fail; original persistent fixture remains a separate final follow-up obligation. D03 specifically tests returned Promise rejection(false), D09 distinguishes synchronous throw(undefined).

The repaired definitive failure branch completes as UNCONFIRMED without waiting forever for an exit listener that was never installed. This is NOT a new universal owner-close deadline: a trustworthy but indefinitely pending terminate/stream event remains pending and requires the separately bounded outer owner. No invented numeric cleanup threshold, OS quiescence or forced retirement guarantee. This remaining real-event behavior needs independent/runtime review, not a pure-test inference.

## Charges and interfaces

Existing A/W, seven counters, worker prepayment and wire47+4n+p+s/479 are unchanged. Six new retained owner slots (retirement state, cleanup presence/value, exit/stdout/stderr observations) add six units to the existing Worker metadata precharge before construction. No refunds/release on UNCONFIRMED. The existing native enumeration/clone exception is unchanged, not a host-memory/RSS guarantee. Private class getters expose retirement state and cleanup presence/value; the session execute/close signatures and public exports are unchanged. Failed-root close now rejects the earlier raw failure as ROOT directed; old case runners expecting fulfilled close need versioned predicates.

## Artifact and loads

Private25-entry package (24emits+package.json), not a public full package/npm-install proof: gzip 18000 bytes, SHA dc20c2be0ea41ff11edeef105c9e93ab349a0601a14d77ecc2d6ac984dfb43b0; tar SHA ecfc97a0d2b1d63f74f97ff52e523f980b483ac8b7f91dc53bf2b2871b2467ce. PRODUCER.json seals every emitted file. Compiler/tool closure remains241 finite statically bound files plus pinned Node22; only current12 source inputs are built. Actual helper load witness lists seven private JS modules, timers/promises and util AFTER hooks; the already imported fakeWorker/events/assert/module/fs bootstrap is source-bound, not falsely called observed nested loading. Matcher and Worker-entry loads are explicitly refused.

## Remaining gates

FOLLOWUP-13.json freezes13 cells/at-most10 real Workers, allUNRUN, with no actual authorization. It requires new emergency-journal/retained-handle receipt binding before launch. Six nonpublic and seven CORE70 gates remain separate in REMAINING-COVERAGE.json. Original5001adc7 counts75PASS/1nonpass/59UNRUN and cell76 unknown telemetry remain immutable; original874450 diagnosis is separate. No transport/engine/runtime acceptance claim.
