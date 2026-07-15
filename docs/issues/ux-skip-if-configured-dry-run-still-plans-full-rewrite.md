---
severity: high
impact: correctness
comment: "One of four filings that the skip path never short-circuits the dry-run; consolidate into ux-skip-if-configured-help-text-lies.md, the Critical that owns the behavior/help mismatch. Its suggested output is the best-specified in the cluster and should survive: 'would skip: already configured (hash match)' versus 'would update: <diffs>'."
---

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
