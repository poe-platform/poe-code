# UX: configure --model accepts any string without catalog validation

## Summary

configure claude --model does-not-exist-xyz --yes --dry-run accepts and plans writing model does-not-exist-xyz (after strip) — no catalog validation at configure time.

## Evidence

```bash
$ poe-code configure claude --model does-not-exist-xyz --yes --dry-run
◇  Claude Code default model
│     does-not-exist-xyz
# full settings plan proceeds
```

## Why it matters

Dead/typo models get written into user config; same class as sonnet-5 defaults.

## Suggested direction

Validate against models API (or known variants) before write; suggest closest match.

## Severity

**Critical**

## Area

Configure / models
