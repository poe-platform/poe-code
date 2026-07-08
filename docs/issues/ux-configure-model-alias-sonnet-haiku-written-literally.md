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
