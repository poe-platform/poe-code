# UX: models --view raw --model anthropic/… returns empty array

## Summary

models --view raw --model claude-haiku-4.5 dumps YAML; --model anthropic/claude-haiku-4.5 returns [] — namespaced id fails on raw view (related --model filter).

## Evidence

```bash
$ poe-code models --view raw --model claude-haiku-4.5
- id: claude-haiku-4.5
…
$ poe-code models --view raw --model anthropic/claude-haiku-4.5
[]
```

## Why it matters

Namespaced ids used elsewhere fail silently as empty JSON/YAML array.

## Suggested direction

Accept namespaced ids; consistent empty message not [].

## Severity

**High**

## Area

Models
