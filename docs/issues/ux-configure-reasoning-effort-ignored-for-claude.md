---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure-payload.ts:108 only resolves reasoningEffort when adapter.configurePrompts.reasoningEffort exists; src/providers/claude-code.ts:58-67 defines only a model prompt, so --reasoning-effort is silently dropped for claude. No 'effortLevel' string exists in src/ or packages/ (rg found matches only under docs/), so the xhigh in the diff is pre-existing user settings, not written by poe-code. Duplicate of ux-configure-reasoning-effort-still-ignored-always-high.md."
comment: "Third filing of the ignored --reasoning-effort bug; retire into ux-configure-reasoning-effort-still-ignored-always-high.md, the most complete. Its distinct hypothesis is worth carrying over and testing rather than discarding: that codex honours the flag while claude does not, which would make this agent-specific rather than global - though ux-configure-codex-reasoning-effort-medium-partial.md suggests the codex path is also unreliable."
---

# UX: configure --reasoning-effort ignored for claude (still writes xhigh)

## Summary

configure claude --model opus-4.7 --reasoning-effort low --yes --dry-run still plans effortLevel xhigh — flag not applied for claude (codex path may differ).

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-opus-4.7 --reasoning-effort low --yes --dry-run
+"effortLevel": "xhigh"
```

## Why it matters

Documented flag appears to work for codex but not claude; users cannot lower effort.

## Suggested direction

Honor --reasoning-effort for claude settings effortLevel; map low/medium/high/xhigh.

## Severity

**High**

## Area

Configure / models
