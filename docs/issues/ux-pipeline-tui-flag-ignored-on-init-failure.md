---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:1025-1035 honours --tui; runPipelineWithDashboard starts the dashboard at pipeline.ts:648 before init runs and reports init failure via appendOutput(\"error\") at pipeline.ts:713-717; toolcraft-design/src/dashboard/should-use-dashboard.ts:12-15 falls back to logger output only when stdin/stdout are not TTYs, which matches the piped transcript in the report; success markers are tracked in ux-failure-shown-as-success-markers.md"
comment: "Reasonable but its premise needs care: --tui is not ignored so much as never reached, because the model failure happens during init before any dashboard could open. That makes preflight the real ask - validate the model before entering the TUI path - which is its own suggestion and is sound. Note the underlying failure is the dead sonnet-5 default, so this may largely evaporate with the constants fix; the success-marker half belongs to ux-failure-shown-as-success-markers.md."
---

# UX: pipeline --tui does not change failure UX when init fails immediately

## Summary

pipeline run --tui still shows non-dashboard failure path with success markers and Problems-before-error when model init fails, so --tui appears ignored on the common failure path.

## Evidence

```bash
$ poe-code pipeline run --yes --tui --plan docs/plans/23-toolcraft-yaml-output.md
✓ agent: API Error: 400 Unsupported model…
■  Error: Pipeline initialization failed…
```

## Why it matters

Users pass --tui expecting dashboard; get same broken markers UX.

## Suggested direction

Preflight model before TUI; or open dashboard with error state; fix success markers.

## Severity

Medium

## Area

Pipeline / TUI
