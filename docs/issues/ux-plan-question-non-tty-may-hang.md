---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:544 with --yes skips requireInteractiveStdin and calls runPlanSession -> sdkSpawn(agent, prompt, { interactive: true }) at plan.ts:962, launching an interactive agent on non-TTY stdin with no fail-fast guard; probe `npm run dev -- plan 'improve tests' --yes --dry-run </dev/null` printed 'Dry run: would run plan session with claude-code for improve tests.' confirming the --yes path proceeds to spawn rather than refusing"
comment: "Consolidate with ux-plan-question-starts-session-without-mode.md and note the tension: this reports a hang past 60s with --yes, that reports --yes producing a prompt and starting a session, and ux-plan-unknown-subcommand-treated-as-question.md shows a clean non-TTY refusal for the same command shape. Three different outcomes for plan-with-a-question - resolve which is current before scheduling. A hang is the worst case and worth fixing if real, but the refusal message in that third file suggests the guard already exists on some path."
---

# UX: plan with question non-TTY may hang instead of failing fast

## Summary

poe-code plan "improve tests" --yes in non-TTY can hang past 60s rather than ValidationError requiring TTY or agent spawn with explicit mode.

## Evidence

Probe: plan "improve tests" --yes timed out after 60s in non-TTY audit.

## Why it matters

Non-interactive plan drafting must fail fast or run headless with clear mode.

## Suggested direction

Non-TTY: require --agent/--yes policy; fail with Use spawn or provide TTY.

## Severity

**High**

## Area

Plan / non-TTY
