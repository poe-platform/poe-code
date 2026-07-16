---
severity: medium
impact: usability
comment: "Contentless duplicate within the wrong-kind-chrome quartet; retire. Its four-word summary ('Good text bad class') is an accurate description of the entire systemic UserError issue and could serve as its title."
reproduced: y
recommendation: no-fix
evidence: "packages/pipeline/src/plan/parser.ts:540 throws a plain Error 'Invalid plan YAML: \"kind\" must be \"pipeline\".' and src/cli/commands/pipeline.ts:1271-1371 wraps parsePlan in try/finally only, so src/cli/bootstrap.ts:71-78 takes the non-CliError branch; probe 'npm run dev -- pipeline validate docs/plans/32-agent-goal.md' (kind: plan) printed 'Error: Invalid plan YAML: \"kind\" must be \"pipeline\".' plus 'See logs at /Users/kjopek/.poe-code/logs/errors.log for more details.'; duplicate of ux-pipeline-validate-wrong-kind-see-logs.md"
---

# UX: pipeline validate wrong kind system chrome

## Summary

kind must be pipeline + See logs.

## Evidence

validate non-pipeline plan.

## Why it matters

Good text bad class.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Pipeline
