---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "Probe 'npm run dev -- configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run' emits mkdir/create settings.json/rename plan then 'Dry run: would configure Claude Code.', never 'would skip'; but planned content genuinely differs from live file, so the non-skip is defensible - src/cli/commands/configure.ts:148-156 short-circuit exists and works (see cursor positive), gated on overlay.hasMaterialChange (configure.ts:564-586)"
comment: "Reconfirm duplicate within the skip quartet, near word-for-word with its sibling; retire. Four filings for one behavior is count inflation, and the cluster's real content is already carried by the Critical plus the cursor positive."
---

# UX: skip-if-configured with matching sonnet-4.6 still full rewrite (reconfirm)

## Summary

configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes --dry-run still plans full settings create despite live model match — Critical skip class still open.

## Evidence

◇  Claude Code default model → anthropic/claude-sonnet-4.6
# full +settings.json create plan, not would skip

## Why it matters

Reconfirm --skip-if-configured still untrustworthy when model matches.

## Suggested direction

Dry-run: would skip: already configured.

## Severity

**High**

## Area

Configure
