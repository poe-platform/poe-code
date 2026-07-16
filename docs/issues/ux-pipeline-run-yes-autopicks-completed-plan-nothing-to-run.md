---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/pipeline/src/plan/discovery.ts:188-190 returns candidates[0] (alphabetical, ignoring done/total) when assumeYes and no explicit plan; src/cli/commands/pipeline.ts:1087-1091 logs 'Nothing to run.' then continues to logger.success('Pipeline run finished.') with exit code 0"
comment: "Duplicate in substance of ux-pipeline-run-autopicks-plan-and-ignores-missing-task-context.md; consolidate into one autopick issue. Its evidence is the better of the two because it names the plan silently chosen, showing the selection is real rather than inferred. Benign here only because that plan was already complete - the same autopick with pending tasks would run an agent against a plan the user never named. Its exit-code question (0 or 2 when nothing is pending) is worth answering in the survivor."
---

# UX: pipeline run --yes autopicks a plan and reports Nothing to run

## Summary

pipeline run --yes without --plan autopicks docs/plans/tiny-http-mcp-server-production-hardening.md (21/21 done) and finishes with Nothing to run / Pipeline run finished success — silent autopick of completed plan looks like success.

## Evidence

```bash
$ poe-code pipeline run --yes
◇  Plan: docs/plans/tiny-http-mcp-server-production-hardening.md
◇  Tasks: 21/21 done
●  Nothing to run.
◆  Pipeline run finished.
```

## Why it matters

Non-TTY should require --plan or fail if nothing pending; success glyph on no-op confuses.

## Suggested direction

Require --plan non-TTY; if all done: No pending tasks in plan X (exit 0 or 2 policy).

## Severity

**High**

## Area

Pipeline
