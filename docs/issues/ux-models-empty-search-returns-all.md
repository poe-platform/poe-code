---
severity: medium
impact: correctness
comment: "Keep as canonical of the models empty-filter trio (covers --search and --provider together). Its argument is the strongest in the empty-flag family: scripts passing an unset env var get the whole catalog rather than an error, so the failure is silent and entirely plausible in CI. Otherwise part of ux-empty-model-flag-behavior-inconsistent.md."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:372 'if (commandOptions.provider)' and :384 'if (commandOptions.search)' use truthiness, so empty strings skip filtering, while hasActiveFilters at :173 checks '!== undefined' and still prints the N/N count; contrast normalizeRequiredFilter at :198 which rejects empty --feature."
---

# UX: models --search "" and --provider "" return all 341 models

## Summary

Empty string filters are treated as no filter (341/341) rather than validation error — easy footgun in scripts that pass empty env vars.

## Evidence

```bash
$ poe-code models --search ""
●  341/341 models
$ poe-code models --provider ""
●  341/341 models
```

## Why it matters

Empty explicit flags should error or no-op with warning.

## Suggested direction

Reject empty --search/--provider when flag present.

## Severity

Medium

## Area

Models
