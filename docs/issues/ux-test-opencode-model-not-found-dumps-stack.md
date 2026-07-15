---
severity: high
impact: correctness
comment: "Keep as canonical of this pair. Real and correctly High: poe-code rewrites anthropic/claude-haiku-4.5 into poe/anthropic/claude-haiku-4.5 and opencode rejects it, so our own namespace mapping produces an id the target agent cannot resolve - a correctness bug in the mapping, not a user error. Same triple-namespace defect as ux-opencode-model-triple-namespace.md, here proved to break at runtime rather than only looking odd. The effect/bun stack dump is secondary but confirms the raw agent error passes through unmapped."
---

# UX: test opencode fails with Model not found and agent stack dump

## Summary

test opencode --model anthropic/claude-haiku-4.5 fails: Model not found: poe/anthropic/claude-haiku-4.5 with full effect/bun stack and ProviderModelNotFoundError — triple namespace + raw agent error.

## Evidence

```bash
$ poe-code test opencode --model anthropic/claude-haiku-4.5
■  Error: spawn opencode: expected "OPEN_CODE_OK" in stdout.
│  Model not found: poe/anthropic/claude-haiku-4.5. Did you mean: opencode?
│  ProviderModelNotFoundError … stack …
```

## Why it matters

Health check unusable; model id mapping broken for opencode test path.

## Suggested direction

Map catalog model to opencode id correctly; UserError without stack.

## Severity

**High**

## Area

Test / opencode
