---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "npm run dev -- configure claude --yes --dry-run previews '\"model\": \"claude-sonnet-5\"'; default is src/cli/constants.ts:14 CLAUDE_CODE_VARIANTS.sonnet, written unvalidated via src/providers/claude-code.ts:113 stripModelNamespace; src/cli/commands/configure-payload.ts:76-105 has no catalog check"
comment: "Member of the Critical sonnet-5 dead-default cluster seen through the dry-run lens. Its distinct point is worth preserving: dry-run is the last checkpoint before a bad write, so previewing a known-invalid id without complaint is a missed catch - dry-run should validate, not just render. Otherwise merge into the sonnet-5 cluster; the fix is configure-time catalog validation (ux-configure-accepts-any-string-as-model-no-catalog-check.md)."
---

# UX: configure dry-run still plans to write known-stale model id

## Summary

configure --yes --dry-run for claude shows default model anthropic/claude-sonnet-5 and would write model claude-sonnet-5 into settings even though API rejects that id.

## Evidence

```bash
$ poe-code configure claude --yes --dry-run
◇  Claude Code default model
│     anthropic/claude-sonnet-5
… +"model": "claude-sonnet-5",
```

## Why it matters

Dry-run preview should catch invalid defaults before apply; currently previews broken config.

## Suggested direction

Validate model against catalog during configure; refuse/warn on unsupported ids.

## Severity

**High**

## Area

Configure / models
