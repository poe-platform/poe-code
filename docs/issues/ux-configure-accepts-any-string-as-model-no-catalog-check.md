---
severity: critical
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/options.ts:206-209 resolveModel returns explicit --model value unchanged with no catalog check; src/cli/commands/configure-payload.ts:98 passes options.model straight into payload.model, bypassing resolveChoices()"
comment: "Keep as canonical of this pair - better evidence, showing the bad id surviving the strip and being planned into settings. This is the root cause beneath the whole sonnet-5 family and ux-claude-settings-model-corrupted-to-fable-restored.md: nothing validates model ids on write, so dead defaults, typos and garbage all reach live config and fail late at spawn. Fix here and much of the late-failure cluster collapses. Note ux-configure-accepts-invalid-model-without-validation.md rates identical behavior High against this Critical - normalise."
---

# UX: configure --model accepts any string without catalog validation

## Summary

configure claude --model does-not-exist-xyz --yes --dry-run accepts and plans writing model does-not-exist-xyz (after strip) — no catalog validation at configure time.

## Evidence

```bash
$ poe-code configure claude --model does-not-exist-xyz --yes --dry-run
◇  Claude Code default model
│     does-not-exist-xyz
# full settings plan proceeds
```

## Why it matters

Dead/typo models get written into user config; same class as sonnet-5 defaults.

## Suggested direction

Validate against models API (or known variants) before write; suggest closest match.

## Severity

**Critical**

## Area

Configure / models
