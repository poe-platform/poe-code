---
severity: medium
impact: capability-gap
comment: "Another data point for ux-install-skill-flags-inconsistent-across-commands.md: plan install has no --force while experiment and pipeline do (and memory has none either). Retire into that umbrella. Its alternative is worth keeping in the survivor: if plan install is deliberately create-only, say so - the inconsistency may be intentional and merely undocumented."
---

# UX: plan install has no --force (unlike pipeline/experiment)

## Summary

plan install rejects --force as unknown option while experiment/pipeline have --force — inconsistent installer contracts (extends skill install flags issue).

## Evidence

```bash
$ poe-code plan install --agent claude-code --local --force
error: unknown option '--force'
```

## Why it matters

Reconfirm installer flag matrix inconsistency.

## Suggested direction

Add --force or document why plan install is create-only.

## Severity

Medium

## Area

Plan / install
