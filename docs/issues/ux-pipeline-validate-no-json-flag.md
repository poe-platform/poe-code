---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "pipeline validate declares only --preview (src/cli/commands/pipeline.ts:1267-1271); no --json option and no global --json in resolveCommandFlags, so the flag errors as unknown"
comment: "Member of the --json inconsistency family (ux-json-flag-inconsistent-across-commands.md); retire into it. Its case is among the strongest in that family: validate exists to be run in CI, so a machine-readable verdict is closer to a core requirement than a nicety - and plan archive already returns JSON (ux-plan-archive-json-output-good.md), so the convention exists."
---

# UX: pipeline validate has no --json flag

## Summary

pipeline validate --json is unknown option — cannot machine-parse validation results.

## Evidence

```bash
$ poe-code pipeline validate … --json
error: unknown option '--json'
```

## Why it matters

CI needs machine-readable validate.

## Suggested direction

Add --json success/error payload.

## Severity

Medium

## Area

Pipeline
