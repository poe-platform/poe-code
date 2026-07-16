---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure claude --model sonnet --yes --dry-run prints '+  \"model\": \"sonnet\",'; src/cli/options.ts resolveModel returns value verbatim and src/providers/claude-code.ts:114 writes stripModelNamespace(model) with no alias lookup against CLAUDE_CODE_VARIANTS (src/cli/constants.ts:12-16, sonnet -> anthropic/claude-sonnet-5)"
comment: "Reconfirm duplicate of the sonnet half of ux-configure-model-alias-sonnet-haiku-written-literally.md; retire into it. Note its suggested target (anthropic/claude-sonnet-4.6) is the corrected id rather than what constants actually hold (sonnet-5), so it quietly assumes the constants fix has landed - keep that dependency explicit when merging."
---

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
