---
severity: critical
impact: correctness
comment: "Excellent filing, correctly Critical: it proves the default is dead (models --search sonnet-5 gives 0/341), proves the alternative works (spawn with sonnet-4.6 succeeds), and establishes the blast radius - every new user's default configure path. This is the symptom; ux-constants-source-of-dead-sonnet-5.md is the cause. Keep both, link them, and fix once in constants with the CI check both files request."
reproduced: y
recommendation: fix
evidence: "src/cli/constants.ts:14,18 set DEFAULT_CLAUDE_CODE_MODEL to anthropic/claude-sonnet-5; claude-code.ts:64,91,118 use it. 'npm run dev -- configure --yes --dry-run' prints 'Claude Code default model anthropic/claude-sonnet-5'; 'npm run dev -- models --search sonnet' returns 2/344 (sonnet-4.6, sonnet-4.5) with no sonnet-5."
---

# UX: configure --yes --dry-run always defaults to dead sonnet-5

## Summary

Any configure --yes --dry-run without --model resolves Claude Code default model to anthropic/claude-sonnet-5 — reconfirmed independent of skip-if-configured. Catalog has sonnet-4.6; spawn/test with sonnet-4.6 work.

## Evidence

```bash
$ poe-code configure --yes --dry-run
◇  Claude Code default model
│     anthropic/claude-sonnet-5
$ poe-code models --search sonnet-4.6
●  1/341 — anthropic/claude-sonnet-4.6
$ poe-code spawn claude … --model anthropic/claude-sonnet-4.6  # works
```

## Why it matters

Default configure path is poisoned for every new user and dry-run review.

## Suggested direction

Change DEFAULT_CLAUDE_CODE_MODEL to sonnet-4.6 or live catalog pick; CI check.

## Severity

**Critical**

## Area

Config / models
