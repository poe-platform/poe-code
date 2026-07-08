# UX: configure --reasoning-effort bogus is silently ignored

## Summary

configure claude --reasoning-effort bogus --yes --dry-run still plans effortLevel xhigh without rejecting unknown level — extends silent ignore of reasoning-effort.

## Evidence

```bash
$ poe-code configure claude --reasoning-effort bogus --yes --dry-run
# still +"effortLevel": "xhigh"
●  Dry run: would configure Claude Code.
```

## Why it matters

Explicit invalid flags must error.

## Suggested direction

Validate against agent-supported levels; ValidationError with allowed list.

## Severity

**High**

## Area

Configure
