---
severity: medium-high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "packages/maestro/src/index.ts:224 runDryRun opens the configured task list and packages/maestro/src/config/validate.ts:105 calls verifyGhProject over the network; packages/task-list/src/backends/gh-issues-client.ts:36 throws a plain Error 'GitHub GraphQL request failed with status 401: <raw body>' with no mapping in src/cli/errors.ts. Duplicate of ux-maestro-dry-run-github-401-without-workflow.md cluster."
comment: "Contentless third duplicate within the maestro dry-run cluster; retire. Its 'dry-run should teach setup' framing is a nice articulation of what the fix is for and can survive as one line in the canonical. Rated Medium-High against its High twins for identical behavior; normalise."
---

# UX: maestro --dry-run GitHub 401

## Summary

Dry-run hits GraphQL 401 JSON.

## Evidence

maestro --dry-run.

## Why it matters

Dry-run should teach setup.

## Suggested direction

Config first; map 401.

## Severity

Medium–High

## Area

Maestro
