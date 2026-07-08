# UX: models --model rejects namespaced ids (anthropic/… → 0 hits)

## Summary

models --model anthropic/claude-haiku-4.5 → 0/341; models --model claude-haiku-4.5 → 1 hit. Help says exact model id; examples use un-namespaced ids only — namespaced ids used everywhere else fail here.

## Evidence

```bash
$ poe-code models --model anthropic/claude-haiku-4.5
●  0/341 models
$ poe-code models --model claude-haiku-4.5
●  1/341 models
```

## Why it matters

Inconsistent model id language across commands.

## Suggested direction

Accept namespaced and bare ids; document both.

## Severity

**High**

## Area

Models
