---
severity: high
impact: correctness
comment: "Duplicate of ux-models-search-confirms-sonnet-5-absent-from-catalog.md; retire into it or fold both into the sonnet-5 root-cause issue as evidence. Its extra check is worth keeping: both 'sonnet-5' and 'claude-sonnet-5' return zero, which rules out a search-token artefact and confirms the id is genuinely absent."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- models --search sonnet => 2/344: claude-sonnet-4.6, claude-sonnet-4.5; no sonnet-5. Dead id hard-coded at src/cli/constants.ts:3,14. Duplicate of ux-models-search-confirms-sonnet-5-absent-from-catalog.md"
---

# UX: models --search sonnet-5 returns 0 (catalog proves dead id)

## Summary

models --search sonnet-5 and --search claude-sonnet-5 return 0/341 — catalog has no sonnet-5; product defaults still hard-code it. Live proof dead id is absent from API.

## Evidence

```bash
$ poe-code models --search sonnet-5
●  0/341 No models match
$ poe-code models --search claude-sonnet-5
●  0/341 No models match
# live catalog has anthropic/claude-sonnet-4.6
```

## Why it matters

Reconfirm Critical dead sonnet-5 with catalog evidence.

## Suggested direction

Replace all sonnet-5 defaults with sonnet-4.6; CI FRONTIER_MODELS resolve.

## Severity

**High**

## Area

Config / models
