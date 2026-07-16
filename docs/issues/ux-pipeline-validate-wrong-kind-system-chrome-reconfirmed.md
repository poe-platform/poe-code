---
severity: medium
impact: usability
comment: "Reconfirm duplicate within the wrong-kind-chrome quartet; retire. Four files for one 'See logs' line on one command is count inflation."
reproduced: y
recommendation: no-fix
evidence: "packages/pipeline/src/plan/parser.ts:540 throws plain Error, so src/cli/bootstrap.ts prints 'Error: ...' plus 'See logs at ...'; duplicate of ux-pipeline-validate-wrong-kind-see-logs.md"
---

# UX: pipeline validate wrong kind still system chrome (reconfirmed)

## Summary

pipeline validate on agent-goal plan: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware message exists but still system chrome.

## Evidence

pipeline validate 32-agent-goal.md → kind must be pipeline + See logs.

## Why it matters

Reconfirm UserError without logs for kind mismatch.

## Suggested direction

UserError; suggest plan vs pipeline commands.

## Severity

Medium

## Area

Pipeline
