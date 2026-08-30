# Bounded coordinator report candidate V1

Authorization: report repair only, separately from the source-only builtin
diagnosis. No change to getBuiltinModule, CJS/load/asset guards, package inputs,
permissions, engine adapters, semantic expectations or historical raw captures.
No admission grant is issued or consumed by this packet.

## Concrete integration candidate

OVERLAY.json is an exact hash-bound, replacement-by-replacement delta against
the immutable V6 coordinator and two worker readers. It is DATA, not applied to
those frozen files. It wires the executable publisher.mjs into the coordinator
tail, replaces coordinator save() with records.mjs, and adapts authenticated
worker/config/STAGED/admission-result reads to bounded multipart documents.
The 2MiB config/stage logical bounds remain (engine config strictly less).
Receipt/config hashes now authenticate the physical JSON record or multipart
descriptor; every referenced part and reconstructed logical JSON is also hashed.
All unaffected coordinator/worker bytes are retained by exact replacements.

Every stored record or part is at most 262144 bytes. Descriptor records have the
same cap. One coordinator-owned store accounts all of its attempted bytes
(including failed writes and descriptors) against 268435456. The new explicit
32MiB maximum logical document, depth64/node1M serializer refusal bounds are
conservative verifier limits, NOT a raised evidence cap or product resource
policy. Config readers retain their smaller inherited bounds. A root can reject
this conservative profile rather than silently dropping an oversized report.

Full large receipts and errors become authenticated raw-byte parts plus bounded
JSON references, not truncated accepted reports. The serializer accepts the
existing plain JSON evidence shape, preserving JSON undefined-field behavior,
and refuses cycles, accessors, custom toJSON and unsupported object prototypes.
Explicit primary-presence envelopes additionally distinguish null/undefined.
Partial artifacts remain on any failure; a descriptor is only written last.
This is not a transaction or crash-durability guarantee.

The terminal summary contains status, reference hashes, compact child closure
and error codes, never nested full probe reports. Each terminal attempt is
bounded to 32768 bytes, below the unchanged 65536-byte stdout/stderr limits.
There is at most one stdout attempt and one stderr fallback. A failure preserves
primary selection, later publication/output failures, nonzero disposition and
known child identity/closure. Independent receipt qualification requires both
authenticated artifacts AND closed exit0; an all-PASS JSON is not sufficient.

## Presealed synthetic invocation

After SEAL.json and this source packet are committed, run launch.mjs exactly
once with Node22.22.2, --unhandled-rejections=strict and
--max-old-space-size=256. It authenticates tools/inputs before spawning the
controls.mjs driver with the same flags and captures its closure separately.
The synthetic driver has a 300s outer timeout, not a hard-preemption promise.
CASES.json freezes 16 families and four actual stub-only
children (three report drivers and one launch-ledger persistence-fault stub).
Inherited supervisor bounds: 30s + 2s TERM + 1s KILL, per-stream64KiB,
FD3 cumulative262144, concurrency1. Tests use no product/comparator import,
network, native command, alternate engine entry or retained old captured tail.

Ordinary assertion failures aggregate only after child closure and frozen-input
integrity; unsafe acquisition/reaping/binding failures stop dependents. Positive
driver exit0, deliberately all-PASS/exit7, output-failure/exit1 and stub exit0
followed by capture-persistence failure are separate observed dispositions.
The incorrect-mode and 262145-byte reference files are deliberately malformed
synthetic INPUT fixtures, not qualified output records. The reduced1KiB quota
is a countercontrol only and cannot raise the actual256MiB maximum.

## Boundaries still requiring different review/root

This is a report publication/storage candidate, NOT a complete V7 admission
recipe/interface. No frozen files are patched in place. Applying the delta needs
a newly sealed recipe including its readers, artifact-schema bindings, worker
and authorization interfaces, plus a fresh different review and root grant.
Store accounting covers coordinator-managed emitted records; the future full
recipe must also bind/account small worker operation claims and all other
out-of-store evidence writes. No whole-verifier cumulative proof is inferred
from these report controls. Pre-authority/module-load exceptions outside the
coordinator's existing report-tail boundary are likewise not newly certified.
Actual engine composition and new report artifact layouts remain unexecuted.

The current getBuiltinModule denial remains intact; its profile adjudication is
separate. Old V6 RESULT531954/STAGED979544/config685153/two receipt318162/317978
over-cap artifacts remain failures to qualify the new per-record requirement.
The 294045 missing coordinator stdout bytes remain IRRECOVERABLE and are never
reconstructed from RESULT. Old histories, W07 nonexecution UNQUALIFIED and the
unauthorized99-semantic cohort remain unchanged.
