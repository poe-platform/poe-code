---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:263-279 formatPipelineConfigSummary pushes 'Model: <model>' when options.model set; emitted at line 678 in onPlanResolved before stopReason nothing_to_run handling at line 1087"
comment: "Positive worth keeping for one reason: it establishes that pipeline echoes the resolved model in its Config block - exactly the 'show the resolved value' affordance the configure cluster keeps asking for (ux-configure-haiku-full-id-rewrites-to-haiku-4-5.md, ux-configure-cursor-model-flag-silent-noop.md). Cite it there as the in-product precedent. Its nothing-to-run caveat belongs to ux-pipeline-nothing-to-run-success-framing.md."
---

# UX: pipeline run shows model override even when Nothing to run (positive-ish)

## Summary

pipeline run with --model shows Model: anthropic/claude-haiku-4.5 in Config even when 21/21 done and Nothing to run — good that model is displayed; still success framing on nothing.

## Evidence

pipeline run --model haiku … → Config includes Model line; Nothing to run.

## Why it matters

Positive config echo; nothing-to-run framing still an issue.

## Suggested direction

Keep model echo; change nothing-to-run to info status.

## Severity

Low

## Area

Pipeline / positive pattern
