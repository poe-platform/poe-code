---
severity: critical
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/configure.ts:148-158 skips only when hasMaterialConfigureChange() is false, so an existing differing model still triggers a real write; src/cli/constants.ts:18 sets DEFAULT_CLAUDE_CODE_MODEL to anthropic/claude-sonnet-5 and src/providers/claude-code.ts:118 merges it into ~/.claude/settings.json when --model is omitted, overwriting claude-sonnet-4-6."
comment: "The most consequential file in the skip cluster and correctly Critical: a flag named --skip-if-configured performed a real write that replaced a working sonnet-4.6 config with the dead sonnet-5, and the audit had to restore it by hand. Data loss caused by a safety flag is the worst possible failure mode for one. It also demonstrates the compounding this audit keeps finding: the skip bug supplies the write and the dead default supplies the payload. Its fix list is right; the first item ('never write when any config exists') is the safe default until the semantics in ux-skip-if-configured-still-writes-when-model-differs.md are settled."
---

# UX: configure --skip-if-configured --yes rewrote live config to dead sonnet-5

## Summary

During audit, `configure --skip-if-configured --yes` (no agent, no dry-run) performed a real configure that set model to claude-sonnet-5, overwriting a previously working sonnet-4.6 configuration. Flag did not skip; default dead model was written to disk.

## Evidence

```bash
$ poe-code configure --skip-if-configured --yes
◇  Claude Code default model
│     anthropic/claude-sonnet-5
◆  Configured Claude Code.
# ~/.claude/settings.json model became claude-sonnet-5
# Restored via configure --model anthropic/claude-sonnet-4.6 --yes
```

## Why it matters

Destructive silent rewrite of working agent config to a dead model under a "skip" flag is Critical severity for data integrity.

## Suggested direction

Never write on --skip-if-configured when any config exists; never default to catalog-missing models; require explicit --model to change model.

## Severity

**Critical**

## Area

Configure / models
