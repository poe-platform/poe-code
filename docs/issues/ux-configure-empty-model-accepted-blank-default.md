---
severity: high
impact: correctness
comment: "Real and distinct from the catalog-validation issue: --model \"\" is not an unknown id but a blank value that survives into a planned settings rewrite, so a catalog check that only validates non-empty strings could still miss it. Keep as the empty-string case and fix alongside ux-configure-accepts-any-string-as-model-no-catalog-check.md; same empty-flag family as ux-agent-empty-api-key-silently-uses-stored.md."
reproduced: y
recommendation: fix
evidence: "src/cli/options.ts:198-201 resolveModel returns value when 'value != null', so empty string passes; src/providers/claude-code.ts:118 'options.model ?? DEFAULT_CLAUDE_CODE_MODEL' does not catch it; 'npm run dev -- configure claude --model \"\" --yes --dry-run' logs blank 'Claude Code default model' and plans '\"model\": \"\"' into ~/.claude/settings.json."
---

# UX: configure --model "" accepted as blank default model

## Summary

configure claude --model "" --yes --dry-run shows blank default model and still plans full settings rewrite — empty model not rejected (empty flag class).

## Evidence

```bash
$ poe-code configure claude --model "" --yes --dry-run
◇  Claude Code default model
│     
# blank model; continues to plan full settings rewrite
```

## Why it matters

Empty model should ValidationError before any plan; related catalog validation Critical.

## Suggested direction

Reject empty --model. Model must not be empty.

## Severity

**High**

## Area

Configure
