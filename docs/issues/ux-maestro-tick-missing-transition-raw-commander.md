---
severity: medium
impact: usability
comment: "Keep of this pair, since it demonstrates the real annoyance: supplying --task then reveals --transition is also required, so users discover requirements one failure at a time. That argues for validating and reporting all missing required options together - a better fix than reskinning Commander's message. Otherwise part of ux-raw-commander-missing-args.md."
---

# UX: maestro tick missing --transition is raw Commander

## Summary

maestro tick --task foo fails error: required option --transition not specified without design-system framing.

## Evidence

```bash
$ poe-code maestro tick --task foo
error: required option '--transition <fromState:toState>' not specified
```

## Why it matters

First-touch tick errors should list required options together.

## Suggested direction

ValidationError listing --task and --transition requirements.

## Severity

Medium

## Area

Maestro
