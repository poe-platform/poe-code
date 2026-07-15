---
severity: low
impact: none
comment: "One of three near-identical positives about the same 'Unknown provider' message, with a fourth file filing it as a defect. Consolidate all into one item: the message is good, the allow-list is missing. Recording one observation four times across Low and Low-Medium is precisely the count inflation this audit should be pruning."
---

# UX: configure unknown provider message is good (positive)

## Summary

configure --provider notaprovider returns Unknown provider "notaprovider" cleanly (could still list known providers).

## Evidence

```bash
$ poe-code configure claude --provider notaprovider --yes --dry-run
■  Error: Unknown provider "notaprovider".
```

## Why it matters

Good base message; recovery list would improve.

## Suggested direction

Append Known: poe, openai, cloudflare, …

## Severity

Low

## Area

Configure / positive pattern
