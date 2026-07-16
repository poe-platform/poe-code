---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure claude --model haiku --yes --dry-run previews '\"model\": \"haiku\"'; src/cli/options.ts:206-209 resolveModel returns explicit --model verbatim, src/providers/claude-code.ts:113 only strips namespace, no CLAUDE_CODE_VARIANTS lookup (src/cli/constants.ts:12-16)"
comment: "Reconfirm duplicate of the haiku half of ux-configure-model-alias-sonnet-haiku-written-literally.md; retire into it. One incidental observation deserves separate attention: the dry-run also shows claude-sonnet-4-6 in another block while the planned model is 'haiku' - that is the misattribution artefact described in ux-configure-dry-run-shows-full-existing-settings-as-create.md, not a second model bug."
---

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
