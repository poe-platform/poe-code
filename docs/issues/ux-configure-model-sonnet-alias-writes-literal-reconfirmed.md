# UX: configure --model sonnet writes literal sonnet (reconfirmed)

## Summary

configure claude --model sonnet --yes --dry-run plans model: "sonnet" not resolved full id anthropic/claude-sonnet-4.6 — alias footgun reconfirmed.

## Evidence

◇  Claude Code default model → sonnet
+  "model": "sonnet",

## Why it matters

Reconfirm alias resolution platform fix; writing short name breaks agents.

## Suggested direction

Resolve aliases to full catalog ids before write; show resolved id.

## Severity

**High**

## Area

Configure / models
