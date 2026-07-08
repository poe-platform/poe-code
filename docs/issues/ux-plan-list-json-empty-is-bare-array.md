# UX: plan list --kind experiment --output json is bare []

## Summary

Empty plan list as JSON is bare [] without envelope — fine for scripts but inconsistent with design-system empty messages for terminal output.

## Evidence

```bash
$ poe-code plan list --kind experiment --output json
[]
```

## Why it matters

Document bare array contract; terminal empty should say No experiment plans.

## Suggested direction

Keep [] for json; improve terminal empty message.

## Severity

Low

## Area

Plan list
