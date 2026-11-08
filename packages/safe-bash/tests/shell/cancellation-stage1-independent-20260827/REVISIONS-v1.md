# Evidence chronology and refinement

1. Semantic FREEZE-v1 committed before candidate body inspection/execution.
2. Concrete interface reading and cohort-v1 authoring followed. Candidate source
   was already committed; this is not preimplementation testing.
3. review-v1 capture completed naturally on its first execution. Runtime retained
   10/12 pass and two source assertions failing. Build/strict/type-negative and
   three applicable counterfactual checks completed without fixture/compiler
   failures. The complete original evidence-v1 remains immutable.
4. Review of evidence instrumentation found its source recheck authenticated
   sealed bytes but did not separately enumerate the temporary on-disk compiler
   input directory before and after compilation. review-v2 is a separately
   versioned instrumentation refinement: it adds those inventories, compiler
   copied-binary postcheck, tighter relocated negative diagnostics, and verifies
   the prior evidence manifest before replay. No expectation, runtime fixture,
   candidate source, or original result is changed. Repeated runs are not new
   holdouts and the red candidate is not rescored green.
5. First tool invocation to author this refinement was rejected BEFORE command
   execution: `Failed to create unified exec process: nul byte found in provided
   data`. No files or tests ran in that invocation. The corrected authoring
   command avoids the NUL placeholder. This is not a runtime test or mutant kill.

The seal stores raw commit/tree/reachable selected blob objects as base64 with
Git object identities and SHA-256 hashes. Replay authenticates tree paths and
uses the sealed helper bytes, not the live source or loose Git objects. This is
a partial path/object proof, not a full repository clone or an ancestry bundle.
Unrelated live work neither enters nor vetoes the committed-archive run.
