---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/providers/opencode.ts:26-30 providerModel() prefixes PROVIDER_NAME ('poe', src/cli/constants.ts:43) onto any id lacking the 'poe/' prefix, so --model anthropic/claude-haiku-4.5 becomes 'poe/anthropic/claude-haiku-4.5' at the test invocation src/providers/opencode.ts:197; configure manifest (opencode.ts:118) never declares a provider.poe entry with models, so the id is unresolvable. Raw agent stdout+stderr (including the effect/bun stack) is echoed verbatim by src/utils/command-checks.ts:218-221 via formatCommandRunnerResult (command-checks.ts:16-18)"
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
