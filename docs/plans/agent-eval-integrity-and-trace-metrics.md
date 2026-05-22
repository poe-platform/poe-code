---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent Eval Integrity And Trace Metrics

Make `agent-eval` trustworthy for coding-agent comparison before scoring agent behavior in more detail.

## 1. What we're building

Build the P0 evaluation foundation for `@poe-code/agent-eval`:

- Fix evaluator integrity issues that can currently produce incomplete evidence or misleading results:
  - preserve usable event evidence for every supported plan kind (`plan`, `pipeline`, `superintendent`, and `experiment`);
  - make judge evaluation consume an artifact that exists when the judge runs;
  - prevent failed agent execution from being reported as a passing run because some oracle assertions passed;
  - prevent disabled or skipped judge evaluation from silently reducing an otherwise valid score through configured judge weight;
  - end budget enforcement cleanly after agent execution so scorer and judge work are not affected by an execution-only wall-clock timer;
  - extend anti-cheat coverage beyond read/exec/glob events so repository writes/edits and tool inputs cannot bypass outside-clone detection.
- Add trace-derived, named evaluation metrics inspired by DeepEval’s agent-focused metrics while keeping Poe Code’s repository-clone/oracle-test model:
  - `task_completion`;
  - `plan_adherence`;
  - `tool_correctness`;
  - `step_efficiency`.
- Store each metric as an explicit result with score, pass/fail threshold, and reason, and include it in aggregate reporting.
- Keep deterministic oracle tests as the source of code correctness and use trace-derived metrics to evaluate how the agent arrived at the result.

Explicit non-goals for P0:

- Do not replace cloned-repository execution, oracle tests, current plan kinds, budget enforcement, or cheating detection with another evaluation framework.
- Do not import OpenAI Evals’ general benchmark registry or DeepEval’s conversational, RAG, red-teaming, synthetic-data, tracing-platform, or hosted persistence features.
- Do not build dataset generation, benchmark marketplaces, external dashboards, or production trace ingestion.
- Do not use model-judged metrics to override failing deterministic oracle tests.
