---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/providers/claude-code.ts:118 calls stripModelNamespace(options.model ?? DEFAULT_CLAUDE_CODE_MODEL) with no CLAUDE_CODE_VARIANTS alias lookup, so 'sonnet' passes through unchanged; `npm run dev -- configure claude --model sonnet --yes --dry-run` emits +  'model': 'sonnet' in the settings diff. src/cli/constants.ts:14 shows CLAUDE_CODE_VARIANTS.sonnet = anthropic/claude-sonnet-5."
comment: "Keep as canonical of the alias trio: it covers both aliases in one place and carries the detail that matters - CLAUDE_CODE_VARIANTS.sonnet points at the dead sonnet-5, so resolving the alias correctly is not sufficient because the target is also wrong. Two coupled fixes: resolve aliases through CLAUDE_CODE_VARIANTS before the namespace strip, and correct the variant target (ux-constants-source-of-dead-sonnet-5.md). Show the resolved id either way."
---

# UX: configure --model sonnet/haiku writes literal "sonnet"/"haiku" not resolved ids

## Summary

configure claude --model sonnet or haiku dry-run writes model: "sonnet" / "haiku" instead of resolving CLAUDE_CODE_VARIANTS to full catalog ids — aliases not expanded.

## Evidence

```bash
$ poe-code configure claude --model sonnet --yes --dry-run
◇  Claude Code default model → sonnet
+"model": "sonnet"
$ poe-code configure claude --model haiku --yes --dry-run
+"model": "haiku"
```
CLAUDE_CODE_VARIANTS.sonnet = anthropic/claude-sonnet-5 (dead).

## Why it matters

Alias sonnet would write dead short name; haiku may work if agent accepts short names but opaque.

## Suggested direction

Resolve aliases via CLAUDE_CODE_VARIANTS then strip namespace; show resolved id.

## Severity

**High**

## Area

Configure / models
