# Static checker attempts and preserved corrections

1. Preseal `19124b13` preceded the first checker execution. `BEFORE.json` is
   retained unchanged: **1344/1345 assertions**, exit1, solely `plan-hash`.
   All359 bindings matched;350 are candidate Git blobs, seven are sealed
   materialized prerequisites and two are external tools.154 harness modules
   parsed; the active closure has no missing static edge.
2. The failed assumption was this reviewer's, not a candidate defect: the
   interface `planSha256` is the hash of `JSON.stringify({ limits, command,
   phase: 'admission', operations: plan.admission })`, in that key order, as
   inspected in inherited `executor-v4/operations.mjs:4`. It is NOT the raw
   OPERATION-PLAN.json file hash. The raw file is independently recipe-bound.
   No expectation was relaxed to accept a candidate mismatch. The corrected
   explicit projection check is committed before running again. Original
   preseal/checker bytes remain in `19124b13`; BEFORE is never overwritten.
3. This correction also predeclares metadata-only authentication of the four
   handoff evidence references and immutable inheritance checks, plus bounded
   source-token assertions for manually reviewed integrated routes. These are
   static checks, not execution-derived positives. Compressed archive bytes
   may be hashed, never inflated or materialized; archive member metadata is
   not member plaintext. Author runtime counts remain attributed, not rerun.
4. The initial attempt to open prior policy-interface/REPORT.md found no file;
   the actual REVIEW.md was read instead. No evidence was manufactured for that
   nonexistent report. Earlier terminal output truncation was followed by
   bounded reads of the applicable instructions and relevant source bodies.

Git read-only metadata subprocesses and the independent parser/checker are not
candidate child harnesses. Node runs this checker and Git reads explicit bound
paths; neither tool is run through an analyzed candidate launcher or authority.
