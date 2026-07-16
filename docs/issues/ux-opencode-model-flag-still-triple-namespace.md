---
severity: medium
impact: correctness
comment: "Reconfirm duplicate of ux-opencode-model-triple-namespace.md; retire into it. Its contribution is worth carrying: passing an explicit --model does not avoid the rewrite, which rules out the default path as the cause and confirms the mapping is unconditional."
reproduced: y
recommendation: no-fix
evidence: "src/providers/opencode.ts:25-30 providerModel() prefixes PROVIDER_NAME ('poe', src/cli/constants.ts:43) onto any model lacking the 'poe/' prefix, so explicit --model anthropic/claude-opus-4.7 becomes poe/anthropic/claude-opus-4.7 at src/providers/opencode.ts:125; duplicate of ux-opencode-model-triple-namespace.md which is the keeper."
---

# UX: configure opencode --model still writes poe/anthropic/… triple namespace

## Summary

configure opencode --model anthropic/claude-opus-4.7 still plans poe/anthropic/claude-opus-4.7 — reconfirm triple namespace with explicit model flag.

## Evidence

```bash
$ poe-code configure opencode --model anthropic/claude-opus-4.7 --yes --dry-run
+"model": "poe/anthropic/claude-opus-4.7"
```

## Why it matters

Reconfirm opencode id rewrite.

## Suggested direction

Show resolved agent-local id in prompt; document mapping.

## Severity

Medium

## Area

Configure / models
