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
5. Corrected checker at `0d3c46d6` produced immutable `AFTER.json`:
   **1707/1707 static assertions**, exit0. The independent source read then
   identified a limitation in this reviewer's graph seed: launch constructs the
   coordinator subprocess path, rather than importing coordinator.mjs. Thus
   the initial41-member seeded import closure omitted that process entry even
   though coordinator/body/production had been manually read. This is NOT an
   absent candidate dependency. The final presealed scan explicitly seeds
   coordinator.mjs too; retains both earlier outputs; and compares all359
   bound observations and all three namespace censuses with BEFORE/AFTER.
   This correction prevents calling the smaller graph the full active route.
6. Final preseal `aadfc6e8` produced `FINAL.json`: **1712/1712**, exit0;
   154 parsed harness modules,49-member seeded active closure, zero missing
   active static edges,31 source-token assertions, all322 prior bindings
   preserved, all359 live observations and33/28/30 censuses stable against
   both earlier outputs. Three checker invocations total; zero candidate or
   child-harness executions. The sole original failed assertion remains in
   BEFORE.json; the sole historical unbound edge remains listed separately.
7. A documentation-only apply_patch with a duplicated context hunk failed
   verification without changing files. The corrected patch fixes source line
   references, calls the path limit UTF-16 code units, and corrects the manually
   counted interface executable bindings to18 (two entries plus16 modules).
   No candidate or checker expectations/results changed in that wording fix.

Git read-only metadata subprocesses and the independent parser/checker are not
candidate child harnesses. Node runs this checker and Git reads explicit bound
paths; neither tool is run through an analyzed candidate launcher or authority.
