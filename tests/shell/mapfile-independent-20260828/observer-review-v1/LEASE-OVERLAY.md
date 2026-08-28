# Additive ROOT exclusive-cursor choice; proposed product error mapping

2026-08-28. This supersedes only the open causality/queue recommendation in
author ADDENDUM-v2/HANDOFF. Original bytes stay immutable. No product source or
array candidate was inspected/executed for this overlay.

## Ratified by ROOT

The new canonical input-record lease is **exclusive and nonreentrant**. Any
overlapping acquisition through that canonical cursor refuses before an
additional pull or target effect. No implicit queue, inference of recursive
causality, AsyncLocalStorage requirement, or exemption for independent siblings.
The lease may span trusted host `next()`; registration/admission/cancellation
and cooperative cleanup checks still apply. Consumers bypassing the canonical
API are not made detectable. `-u0` selects effective stdin, with known-closed
refusal before target changes. Other FDs and callbacks refuse before pulls/changes.

## Concrete proposed mapping requiring product-freeze ratification

1. Keep root/effective caller cancellation first. Validate builtin argv syntax,
   unsupported features and target spelling next, without input acquisition.
   Register the initially empty cooperative owner before acquiring a lease.
2. The cursor tests/sets its private active-operation state synchronously before
   the first await. A busy acquisition neither queues nor takes a fresh read,
   clears/converts a target, publishes a row, consumes skip/count, or releases
   the existing owner's lease. No target watch/ledger reservation is needed to
   find out that the cursor is busy.
3. Recommend a **private** `ShellInputBusyError` (no new public export/FS errno).
   Mapfile/readarray map it to ordinary builtin status1, empty stdout and diagnostic
   message payload respectively `mapfile: stdin cursor is busy` /
   `readarray: stdin cursor is busy`. Existing shell-origin prefix/newline/sink
   handling remains; no usage text/status2. It is not a limit or caller error.
   Other canonical readers preserve their existing error mapper; do not promise
   every registered command reports the same status merely because its source
   rejected. For builtin read, recommend status1 / `read: stdin cursor is busy`.
4. This ordering makes busy refusal precede target readonly/kind resolution;
   recommend ROOT explicitly approve that narrow priority. Once acquired, the
   accepted array caller/escaping/final-readonly-before-stale ordering remains.
   This does not change arithmetic/array-wide error policy or scalar middleware.
5. Initial target clear/convert must occur **inside the first acquired operation**,
   before skip/read, not before the busy test. The same lease covers a physical
   skip/read and any associated row publication; release after suffix restoration
   and private temporary-owner drain, before diagnostics/arbitrary extra commands.
   A later record's busy failure retains already committed clear/rows/consumption;
   no rollback. Exact -n stop makes no next acquisition or parent return.
6. Apply the overlap check to canonical cursor consumers, including the normal
   read/next/source-line path when sharing that cursor, not only competing mapfile
   calls. Otherwise nested read still queues behind mapfile and the chosen rule
   is not implemented. Ordinary sequential behavior stays unchanged. Legacy
   concurrent consumers that previously queued may now fail; document precisely
   that new private profile, not a general ByteSource concurrency guarantee.
7. Distinguish the cooperative record-operation lease from the cursor's existing
   outstanding opaque read promise. Recommend preserving existing cancellation:
   after abort unwinds the operation, restore any owned suffix and release its
   lease without requiring an opaque pending next/return to settle. The cursor
   still owns its outstanding read; a later permitted operation must reuse that
   read, never create a duplicate pull. Root-wide close still closes admission.
   This is not an early resource-retirement claim for the opaque producer.
   If an implementation instead holds busy until that producer settles, report
   the changed post-child-abort sequential semantics before product freeze.

Recommended future holdouts: two same-cursor attempts before first next resolves;
producer-initiated nested acquisition; independent sibling overlap (same refusal);
different cursor success; read/mapfile and next/mapfile overlap; both aliases;
busy readonly target precedence; busy callback/nonzero-FD syntax precedence;
initial clear untouched on busy; later-row partial state retained; exact-n suffix;
child-local abort with outstanding read reused once; root abort reason identity;
same owner repeated release; borrowed parent return count0. These are requirements,
not product/model passes in this observer review.

G4A remains P for new record/storage/staging/bridges before transfer, E_input for
existing source ownership and E_command for existing post-transfer registered
formatting. No new Budget, private cap reset, combined memory/RSS or hard primitive
preemption claim. Other mapfile numeric/extra/NUL/UTF8/publication choices remain
pending observations/root policy. No native observation depends on arrays acceptance;
actual product mapfile implementation does.
