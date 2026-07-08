# UX: test opencode still fails model mapping poe/anthropic/… (reconfirm)

## Summary

test opencode --model anthropic/claude-haiku-4.5 still: Model not found: poe/anthropic/claude-haiku-4.5 with stack — reconfirm opencode model id mapping broken.

## Evidence

Model not found: poe/anthropic/claude-haiku-4.5. Did you mean: opencode?
ProviderModelNotFoundError stack…

## Why it matters

Reconfirm High opencode test/spawn model mapping.

## Suggested direction

Map catalog model to opencode id; UserError without stack.

## Severity

**High**

## Area

Test / opencode
