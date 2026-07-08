# UX: spawn has no --reasoning-effort (configure-only footgun)

## Summary

spawn --reasoning-effort xhigh|high is unknown option; flag exists only on configure. Users expect spawn-time effort override; must configure first or use agent-specific env.

## Evidence

```bash
$ poe-code spawn claude "…" --mode read --model anthropic/claude-sonnet-4.6 --reasoning-effort high
error: unknown option '--reasoning-effort'
# configure has --reasoning-effort <level>
```

## Why it matters

Effort is a run-time concern for CI; forcing configure is wrong shape.

## Suggested direction

Add spawn/gaslight --reasoning-effort with model-aware allow-list (no xhigh on sonnet-4.6).

## Severity

**High**

## Area

Spawn
