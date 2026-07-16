---
severity: high
impact: correctness
comment: "Reconfirm duplicate; retire into ux-test-opencode-model-not-found-dumps-stack.md. Its 'Did you mean: opencode?' detail is worth carrying as an example of a genuinely absurd suggestion - the agent proposes its own name as a model id, the same edit-distance nonsense as 'list' to 'lint' and 'show' to 'stop'."
reproduced: y
recommendation: no-fix
evidence: "src/providers/opencode.ts:25-30 providerModel() prefixes PROVIDER_NAME ('poe', src/cli/constants.ts:43) onto any id lacking 'poe/', and the test path passes it at src/providers/opencode.ts:197, so --model anthropic/claude-haiku-4.5 becomes poe/anthropic/claude-haiku-4.5; duplicate of ux-test-opencode-model-not-found-dumps-stack.md which is the keeper."
---

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
