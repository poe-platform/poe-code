# Eval orchestration native QA

Use owned paths under `out` and the existing `packages/agent-eval/src/__fixtures__`
source and clone fixtures. Inject deterministic agent responses and ACP events;
never query a live model. Remove only owned outputs after verification.

1. Run the fixture custom scorer as a real child against an owned clone, with
   `CLONE_DIR` and `ORACLE_DIR` set to the clone and fixture oracle directories.
   Check exit zero and its JSON result: one passing `fixture scorer` case with
   duration zero. Keep the scorer's configured timeout and result-path contract.
2. Exercise plan, pipeline, experiment and superintendent eval dispatch using
   their corresponding source fixtures and deterministic agent/orchestrator
   boundaries. Check the successful result, copied starter files and plan,
   persisted eval YAML, result JSON, trace JSON, events JSONL and cheat report.
3. Inject tool-start/tool-complete/usage ACP events into direct and nested runs.
   Check one iteration, 13 input and 8 output tokens, event ordering and persisted
   usage. An outside-clone read must record cheating and an outside-clone write
   must also force correctness to zero.
4. Inject an uninspectable shell redirect. Check a passing verdict, an
   `uninspectable` exec entry with reason `shell-command`, and no cheating flag.
5. Verify starter containment and symlink/error handling using only owned fixture
   copies. Check rejection and cleanup without modifying the checked-in fixtures.

Unit orchestration checks keep these assertions, mount the same fixture bytes in
memfs, and mock only the scorer result and existing agent/orchestrator boundaries.
The scorer's parsing, containment and child-process contract have their own tests.
