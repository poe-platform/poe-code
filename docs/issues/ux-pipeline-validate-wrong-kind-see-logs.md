---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- pipeline validate docs/plans/gaslight-crash-resume.md` printed 'Error: Invalid plan YAML: \"kind\" must be \"pipeline\".' plus 'See logs at ~/.poe-code/logs/errors.log for more details.'; packages/pipeline/src/plan/parser.ts:540 throws a plain Error and src/cli/commands/pipeline.ts:1276 has only try/finally, so src/cli/bootstrap.ts:71-81 takes the non-CliError system-chrome branch"
comment: "One of four filings of the same wrong-kind-plus-See-logs observation; consolidate. All four agree the message is right and only the chrome is wrong, so they collapse into ux-user-errors-look-like-system-failures.md. Its suggested wording ('Expected pipeline plan, got kind=plan') is the clearest of the four and worth carrying."
---

# UX: pipeline validate wrong kind has See logs

## Summary

pipeline validate on plan kind: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware message good, system chrome residual.

## Evidence

Invalid plan YAML: "kind" must be "pipeline".
●  See logs …

## Why it matters

UserError without logs; suggest plan validate.

## Suggested direction

UserError; Expected pipeline plan, got kind=plan.

## Severity

Medium

## Area

Pipeline
