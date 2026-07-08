# UX: configure --skip-if-configured --dry-run still plans full settings rewrite

## Summary

Even with matching model and --skip-if-configured --dry-run, configure still emits full create settings.json plan rather than "already configured, would skip".

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run
# full +settings.json create plan, not skip message
```

## Why it matters

--skip-if-configured does not short-circuit dry-run; users cannot trust skip semantics.

## Suggested direction

Dry-run should say would skip: already configured (hash match) or would update: diffs.

## Severity

**High**

## Area

Configure
