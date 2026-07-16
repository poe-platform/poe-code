---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "src/providers/claude-code.ts:118 stripModelNamespace(...).replaceAll('.', '-'); dry-run prints 'Claude Code default model anthropic/claude-haiku-4.5' while settings.json diff writes +\"model\": \"claude-haiku-4-5\" - resolved id never surfaced"
comment: "Not a defect: the namespace strip and dot-to-hyphen rewrite is deliberate and correct for Claude Code's id format, and the file concedes as much. The legitimate residue is small - configure never shows the resolved agent-local id, so users cannot confirm what was written. Reframe as 'show resolved model id in configure output' and drop any implication the rewrite is wrong. Contrast ux-configure-model-alias-sonnet-haiku-written-literally.md, where the same pipeline genuinely fails."
---

# UX: configure --model anthropic/claude-haiku-4.5 rewrites to claude-haiku-4-5

## Summary

configure with full catalog id rewrites via stripModelNamespace + replace dots with hyphens to claude-haiku-4-5 — reconfirm model id rewrite opacity (works for haiku).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-haiku-4.5 --yes --dry-run
+"model": "claude-haiku-4-5"
```

## Why it matters

Users need to see resolved agent-local id; rewrite is intentional for claude.

## Suggested direction

Show Resolved model: claude-haiku-4-5 in configure output.

## Severity

Medium

## Area

Configure / models
