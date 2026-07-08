# UX: agent/spawn missing required args still raw Commander

## Summary

agent without prompt and spawn without agent print error: missing required argument without design-system framing (unlike many other errors).

## Evidence

```bash
$ poe-code agent
error: missing required argument 'prompt'
$ poe-code spawn
error: missing required argument 'agent'
```

## Why it matters

Inconsistent error skin for first-touch mistakes.

## Suggested direction

Design-system ValidationError with usage examples.

## Severity

Medium

## Area

Errors
