# UX: configure --model haiku writes literal haiku (reconfirmed)

## Summary

configure claude --model haiku --yes --dry-run plans model: "haiku" not full id; dry-run also shows claude-sonnet-4-6 in another block — alias not resolved (same class as sonnet).

## Evidence

```bash
$ poe-code configure claude --model haiku --yes --dry-run
◇  Claude Code default model → haiku
+  "model": "haiku",
```

## Why it matters

Reconfirm alias resolution; short names break agents.

## Suggested direction

Resolve haiku → anthropic/claude-haiku-4.5; show resolved id.

## Severity

**High**

## Area

Configure / models
