# UX: provider login poe --dry-run also plans Claude settings rewrite with effortLevel xhigh

## Summary

provider login poe --api-key sk-fake --dry-run not only would save credential but also plans full ~/.claude/settings.json rewrite including effortLevel xhigh — dry-run flood + dead effort coupling; login should not reconfigure agents.

## Evidence

```bash
$ poe-code provider login poe --api-key sk-fake --dry-run
# includes cat > ~/.claude/settings.json with effortLevel: xhigh
●  Dry run: would save credential for poe.
```

## Why it matters

Provider login dry-run overclaims scope into agent configs; xhigh effort cluster.

## Suggested direction

Credential-only dry-run; intentional-only diffs; no agent rewrite on login.

## Severity

**High**

## Area

Providers / dry-run
