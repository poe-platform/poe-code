---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/harness.ts:569 throws `Unknown harness template \"${kind}\".` with no kind list; harness.ts:101 argument help is only 'Built-in template kind'; packages/agent-harness/src/templates/index.ts:10-15 defines the five valid kinds"
comment: "Reconfirm duplicate within the kinds cluster with no new evidence; retire. Five filings of one missing list, spanning Medium and High, is count inflation: the cluster needs one issue at one severity."
---

# UX: harness new unknown template still no kinds list (reconfirmed)

## Summary

harness new bogus-kind x: Unknown harness template "bogus-kind" — no list of valid kinds; help says Built-in template kind without enumeration.

## Evidence

Unknown harness template "bogus-kind".

## Why it matters

Reconfirm kinds enumeration gap.

## Suggested direction

List valid kinds in error and help.

## Severity

Medium

## Area

Harness
