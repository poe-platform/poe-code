---
severity: low-medium
impact: usability
comment: "Fair and small: '0/341 - No models match the given filters' is technically correct but indistinguishable from a broken filter, when the truth is simply that nothing was added in the window. Its suggested wording is good ('No models added in the last 1d (of 341 total)'). Same false-empty presentation family as the silent-filter cluster - though here the filter works correctly, which makes this a copy fix rather than validation."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:423-425 applies --since as created >= cutoff (correct filter, validated at :182-190), then :429-430 prints generic '<n>/<total> models' and :433 'No models match the given filters.' with no time-window wording; models-command.test.ts:814 asserts that same generic copy."
---

# UX: models --since 1d can be empty without explaining no new models

## Summary

models --since 1d returns 0/341 No models match — correct if no adds in 24h but message looks like filter failure; no "0 models added in last 1d" framing.

## Evidence

```bash
$ poe-code models --since 1d
●  0/341 models
●  No models match the given filters.
```

## Why it matters

Empty since results should state time window explicitly.

## Suggested direction

No models added in the last 1d (of 341 total).

## Severity

Low–Medium

## Area

Models
