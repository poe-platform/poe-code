# Independent final CARRY review preseal

Date: 2026-08-28. Status: prepared before reading the in-progress author packet.
Implemented Through: Not applicable. No product implementation or execution.

Ownership is only this new `final-carry-review-v1/**` directory. This protocol
and `PREDICATES.json` are frozen by their first atomic commit and will not be
changed to accommodate the candidate. Later review code/results are additive.
No `final-carry-v1` contents or ready marker were read before this preparation.

Root has chosen CARRY, not another pending policy round: checkpoint before the
next owned unit, unchanged K, no terminal flush/reset even for empty close, and
pending persists across phases/documents. Required signal AND already-declared
closed-admission guards run after every await, before copy/allocation, and before
final copy/result publication. They add no work charge, diagnostic or error
identity. Existing caller/closed-session/cleanup selection remains controlling.

## Frozen review method

1. Seal these two prepared files before inspecting the author packet. Only then
   consult `/tmp/yq-final-carry-author-ready.txt`, authorized by root for this
   run. Wait at most eight minutes if absent; stop prepared if still unavailable.
   A marker must identify an actual committed candidate, never a live directory.
2. Authenticate the candidate commit's changed paths, declared source manifest,
   and every checker before execution. Read its complete CONTRACT, 194-record
   crosswalk, trace overlays and protected-members inventory from pinned Git
   bytes. Only author packet plus the authorized umbrella may change; no source
   implementation or historical packet rewrite is admitted.
3. Reuse the immutable 0457 independent 64-record data and 20 source bindings.
   Compare the chosen before-next/CARRY fields, retaining the alternate CLOSE
   columns as history. The 16 schedule, five sequence, eight admission and nine
   refusal rows are not redefined. Prospective cancellation traces are schema/
   contract checks, not runtime cancellation experiments.
4. Authenticate accepted N/encoder 914d2c9b and independent 5fa2d5b9 mapping and
   qualification, without duplicating their 32 tuples/36 controls. Verify exact
   references for 54 diagnostics, 21 private caps and nine Budget fields. N5 is
   an observation, not a newly invented reserved diagnostic. Accepted length and
   full846 packaging are not blockers or new replay claims.
5. Snapshot all protected original members' membership, Git modes and SHA-256,
   and compare before/after checks. Verify the original 194/80/62 and 0457 data
   without summing overlapping records as independent cases. Authenticate live
   checker bytes against the pinned candidate/source before running only the
   static checkers required by its README. Inspect their imports/effects first.
6. Run this scope's literal arithmetic, trace-schema and manifest comparisons,
   plus the frozen negative-control families. Mutations are in memory only;
   historical or candidate files are never mutated. Preserve failures verbatim
   in the new results rather than changing frozen expectations.
7. Seal the independent verdict atomically on exact owned paths. Distinguish
   author/static preparation passes from runtime evidence. No native, product,
   package, build, dependency, private checkout or AGENTS copying is permitted.

Actual contradictions are reported precisely. Otherwise deliver a ready static
verdict for the final author-facing handoff; do not reopen root's CARRY/N choices,
invent new resources/features, or grant product implementation GO.
