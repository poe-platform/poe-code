---
severity: high
impact: usability
comment: "Keep as the umbrella for the POE_NO_PROMPT-versus---yes family (configure, install, test, runtime init and gaslight ingest each file it per command). Its one-line framing is the whole issue: the error names an env var while the product contract is --yes, so the message contradicts the documented interface. Retire the per-command instances into it; ux-experiment-install-requires-agent-or-yes-good.md is the in-product counterexample proving the right wording already exists."
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/prompts/interactive/core.ts:133 rejects non-TTY prompts with 'Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively.' and never names --yes, while src/cli/commands/configure.ts:74 registers '-y, --yes' and flags.assumeYes short-circuits prompts at configure.ts:878,884,1024"
---

# UX: Non-TTY prompts recommend POE_NO_PROMPT not --yes

## Summary

Error says POE_NO_PROMPT=1; product contract is --yes.

## Evidence

configure non-TTY.

## Why it matters

Users follow --yes from help.

## Suggested direction

Prefer --yes in error text.

## Severity

**High**

## Area

Interactive / CI
