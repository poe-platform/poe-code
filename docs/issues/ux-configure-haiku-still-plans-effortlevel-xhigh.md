---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "grep finds no effortLevel/xhigh anywhere in src or packages; src/providers/claude-code.ts:104-118 configure merge writes only env + model; dry-run diff shows effortLevel because it pre-exists in ~/.claude/settings.json:143 as \"high\" and the whole merged file renders as additions (separate issue ux-configure-dry-run-shows-full-existing-settings-as-create.md)"
comment: "Duplicate of ux-configure-claude-ignores-reasoning-effort-always-xhigh.md with haiku substituted for sonnet; retire into it. Its value is coverage - it proves the hard-coded xhigh is not sonnet-specific but hits every non-opus model - so carry that generalisation into the canonical rather than keeping a per-model file."
---

# UX: configure haiku still plans effortLevel xhigh (reconfirm)

## Summary

configure claude --provider poe --model anthropic/claude-haiku-4.5 --yes --dry-run plans model claude-haiku-4-5 AND effortLevel xhigh — effort flag ignored / always xhigh reconfirmed for non-opus models.

## Evidence

```bash
$ poe-code configure claude --provider poe --model anthropic/claude-haiku-4.5 --yes --dry-run
◇  Claude Code default model → anthropic/claude-haiku-4.5
+  "model": "claude-haiku-4-5",
+  "effortLevel": "xhigh",
```

## Why it matters

Reconfirm Critical effort always xhigh; haiku does not support xhigh like sonnet.

## Suggested direction

Honor --reasoning-effort; model-aware defaults; never xhigh for haiku/sonnet-4.6.

## Severity

**High**

## Area

Configure / models
