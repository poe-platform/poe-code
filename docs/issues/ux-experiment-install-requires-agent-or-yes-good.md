---
severity: low
impact: none
comment: "Positive pattern and a genuinely good non-TTY message: it names both escape hatches (--agent or --yes) rather than an obscure env var. Cite it as the counterexample in ux-configure-non-tty-demands-poe-no-prompt-not-yes.md and ux-test-nontty-demands-poe-no-prompt-not-yes.md, where the same situation points users at POE_NO_PROMPT instead - proof the good wording already exists in-product."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/experiment.ts:1126 requireInteractiveStdin('Experiment install agent selection requires --agent or --yes when running without an interactive TTY.') - message exists as described; positive note, no defect"
---

# UX: experiment install requires --agent or --yes non-TTY (positive)

## Summary

experiment install --local --force without agent: Experiment install agent selection requires --agent or --yes when running without an interactive TTY — clear (contrast --force still broken for overwrite).

## Evidence

Experiment install agent selection requires --agent or --yes when running without an interactive TTY.

## Why it matters

Positive non-TTY agent selection message.

## Suggested direction

Keep; fix --force separately.

## Severity

Low

## Area

Experiment / positive pattern
