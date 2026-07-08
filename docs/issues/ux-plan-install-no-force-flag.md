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
