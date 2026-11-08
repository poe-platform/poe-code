# Runner corrections after immutable capture-01

No frozen file or capture-01 entry is modified. Candidate identity is unchanged.

1. T20 correctly produced TypeScript diagnostic 2740 for the malformed
   `{ aborted: false }` signal in both source and moved declarations. The original
   runner's diagnostic allowlist omitted 2740 and marked the probe failed despite
   the intended rejection. Version 2 accepts 2740 ONLY for T20 and only when its
   message identifies the missing AbortSignal shape. It does not waive compiler,
   prelude, import, library or unrelated diagnostic errors. All 28 unchanged probes
   are rerun against actual source and rebuilt/moved declarations in a new capture.
   Original source/moved type results remain 27/28; corrected results are separate.

2. Mutation kill attribution must exclude controls already failing on the original
   candidate. The original runner included any assertion failure; M03 included the
   preexisting P03 failure alongside new S12 failures. Version 2 intersects mutant
   failures with baseline-passing IDs. The followup writes a separate audit of
   all 16 original mutant captures, listing only baseline-pass/new-fail witnesses.
   No mutation run, original attribution or original failure is rewritten.

3. P03's larger-index clone subcase fails identically on source and moved JS:
   after p from one argument -pqr, withGetoptsIndex(state,2) returns EOF rather
   than the frozen expected q. This is not yet classified by this correction.
   Three additional source-informed native scenarios distinguish a candidate
   defect from a frozen-oracle defect: a one-element vector, the same vector with
   an unused trailing operand, and a vector shortened after p. They do not enter
   the original 12-script/71-record native denominator. All expect p at index1
   followed by q at index2 under the declared retained-cursor interpretation;
   preserve any native disagreement instead of rewriting it.

The attempted pre-execution v2 commit encountered a concurrent foreign Git
index.lock. That lock was neither removed nor altered. The followup then ran
against these working-tree driver bytes; their commit consequently follows that
execution. This differs from the successfully precommitted v1 driver chronology
and is recorded rather than claimed to be a pre-execution v2 commit.
