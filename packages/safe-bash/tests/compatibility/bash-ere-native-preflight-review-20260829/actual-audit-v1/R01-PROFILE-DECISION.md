# ROOT R01 decision: last-parent nested-capture reporting

Date: August29,2026. Status: **ratified PROJECT profile**, not implementation
acceptance or a retroactive native/product rescore.

## Reporting rule and basis

For the admitted ERE grammar, reported nested captures reflect the last match of
their enclosing repeated parent. An inner capture omitted in that last parent
match must not publish a stale earlier inner string. Preserve its shell-visible
capture index and publish an empty string; do not drop trailing empty slots.

ROOT selects this project rule using the GNU-documented last-parent reporting
model in authority08e40d411dc47bd725cb138e7d419ef2079a2879 and the accepted actual
N01–N06 local Bash3.2.57 value vectors. This does not turn the earlier incomplete
POSIX quotation provenance into a normative POSIX proof or establish other Bash/
libc versions. See `REPORT.md` for the six exact original/native/model comparisons.

Within our grammar's internal model, omitted participation uses the existing
absent/null representation; a genuinely participating empty match remains a
zero-length span. This is a **project/model distinction**, not a claim that the
native NUL output exposed offsets or distinguished those states. N09/N10 show the
same visible empty string. No algorithm or capture-history ranking change is
approved merely by this representation decision; the implementation must preserve
the rest of its admitted matching, accounting, cancellation and ownership contract.

## Required versioned E12 change

Pattern `(a(b)?)+`, subject `aba`:

- Preserve original E12 values `["aba","a","b"]` and spans
  `[[0,3],[2,3],[1,2]]` with their original author result.
- The author-owned versioned fixture must expect values `["aba","a",""]`.
- Its corresponding **project-model**, not native-observed, spans are
  `[[0,3],[2,3],null]`.

This document records the authorized delta; it does not edit the original fixture,
matching engine or shared API. New source and versioned expectations require a
different verifier before acceptance.

## Boundaries and remaining obligations

- I23 is not natively qualified as a62-input family. At most its one designated
  fixed N07 witness is accepted here; preserve the original52 contradictions and
  family result. Do not infer all-case correctness from overlapping N02 input.
- N11/N12 begin without a seeded prior capture. They do not establish nonmatch
  clearing or invalid-pattern preservation of previously populated captures.
- Original seven R01FAIL groups and17PASS/7FAIL per layout remain unrescored;
  original author66/66 remains its original cohort. Policy ratification is not a
  rerun, repaired-source result or blanket reference rebaseline.
- Hidden native offsets, wider grammar/history cases, R02 checkpoint behavior,
  other native versions and forced-termination qualifications remain separate.
- The audit's14,551ms dual-clock difference, actual compliance with the earlier
  deadline, tool-state/accounting limits and consumed single native attempt are
  unchanged. This decision authorizes no additional native invocation.
