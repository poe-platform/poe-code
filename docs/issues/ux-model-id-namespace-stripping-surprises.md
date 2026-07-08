# UX: configure rewrites model ids via stripModelNamespace in opaque ways

## Summary

configure --model anthropic/claude-sonnet-4.6 dry-run writes model as claude-sonnet-4-6 (dots to hyphens / namespace strip) without explaining the rewrite to the user.

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --yes --dry-run
+"model": "claude-sonnet-4-6",
```
constants.ts stripModelNamespace documents lowercase strip of owner prefix; additional normalization may change dots.

## Why it matters

Users pass catalog ids from models command; written config differs without explanation; hard to correlate with API ids.

## Suggested direction

Show resolved model id in configure output; document normalization; prefer storing full catalog id when agent accepts it.

## Severity

Medium

## Area

Configure / models
