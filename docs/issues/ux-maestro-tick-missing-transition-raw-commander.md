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
