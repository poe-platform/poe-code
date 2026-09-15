# Exhaustive harness replay QA

The coverage-demo exhaustive replay unit check reproduced a five-second timeout in isolation. Keep focused snapshot, host-call, random/time, source-identity, and deterministic replay assertions in the fast unit suite. Execute the complete syntax fixture as agent-driven QA instead of a unit timeout.

1. Build the maintained agent-harness workspace closure when no dist-consuming tests are active.
2. Locate packages/agent-harness/src/templates/coverage-demo/coverage-demo.md and its paired .ajs source. Review the real fixture before execution; do not substitute a reduced source.
3. Execute the public assertReplayEquivalent helper against that fixture with deterministic modules and no LLM calls. Use a temporary isolated snapshot location managed by the helper. Execute through a one-off Node invocation; do not add a QA script to the repository.
4. Require every captured and completed snapshot to reproduce the original return value. Require real lint/schema/source-hash admission. Record elapsed time and any thrown error; a timeout or interrupted observation is not a pass.
5. Execute the maintained replay-equivalence unit suite separately and record its result. This QA does not replace the MCP harness loader modern/legacy replay checks or the managed transport suite.

Executed the real coverage-demo Markdown and paired .ajs fixture through the built public assertReplayEquivalent helper after the maintained agent-harness dependency closure built successfully. Real lint/schema/source admission and every captured/completed snapshot passed; the helper returned successfully in 5,539 ms. Evidence: /tmp/mcp-harness-exhaustive-replay-qa-current.log. This used deterministic agent/log adapters and no LLM calls. The helper managed and cleaned up its temporary snapshots. The reduced deterministic unit fixture retains its fast focused helper contract.

Final continuation: repeated the complete fixture through the public built helper with real admission and deterministic adapters. All snapshot replays passed in 10,895 ms while repository checks were running. No LLM calls occurred. Root bundle artifact refresh completed successfully; the maintained repository-wide npm test route was then started separately.
