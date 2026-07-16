---
severity: critical
impact: correctness
comment: "Two Criticals compounding, and worth keeping for the specific interaction: the skip path resolves the default model before comparing against live config, so it both surfaces the dead sonnet-5 and plans a rewrite over a working sonnet-4.6. Its key insight is the ordering - skip should read the current config first rather than resolving a default it may not need. That framing distinguishes it from the other skip filings; the sonnet-5 half belongs to the constants cluster."
reproduced: y
recommendation: fix
evidence: "configure.ts:132 builds payload (resolving default model) before the skip check at configure.ts:148-156; claude-code.ts:64 defaultValue=DEFAULT_CLAUDE_CODE_MODEL=anthropic/claude-sonnet-5 (constants.ts:13,18); probe 'npm run dev -- configure claude --skip-if-configured --yes --dry-run' printed 'Claude Code default model / anthropic/claude-sonnet-5', planned '+ model: claude-sonnet-5', and ended 'Dry run: would configure Claude Code.' instead of skipping"
---

# UX: configure --skip-if-configured --dry-run still shows default model sonnet-5

## Summary

configure claude --skip-if-configured --yes --dry-run (no --model) still resolves Claude Code default model to anthropic/claude-sonnet-5 and plans full rewrite — dead default appears even on skip path dry-run.

## Evidence

```bash
$ poe-code configure claude --skip-if-configured --yes --dry-run
◇  Claude Code default model
│     anthropic/claude-sonnet-5
# full settings create plan
```
Live config is claude-sonnet-4-6.

## Why it matters

Skip dry-run should compare to live config and say would skip; must not advertise dead default.

## Suggested direction

Read current model for skip decision; never surface sonnet-5 as default.

## Severity

**Critical**

## Area

Configure / models
