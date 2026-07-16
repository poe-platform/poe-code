---
severity: medium
impact: usability
comment: "Duplicate within the plan browse non-TTY trio; retire. Its title claims 'first plan' while its siblings say arbitrary/selected - a small but real discrepancy about whether the selection is deterministic, worth settling since it decides whether this is a picker fallback or a genuine autopick. Settled: the code indexes plans[0] unconditionally, so this doc's 'first plan' wording is the literally accurate one - it is a deterministic autopick, not a picker fallback. Retire anyway into ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md (already triaged fix), but carry the 'first' precision into that canonical filing so the fix targets the autopick."
reproduced: y
recommendation: no-fix
evidence: "packages/plan-browser/src/browser.ts:49-50 - 'if (options.assumeYes || process.stdin.isTTY !== true)' then 'await renderPlanPreview(plans[0]!)' dumps the first discovered plan's rendered body and returns, with no error, list, or hint; behaviour reproduces but is canonically tracked in ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md, hence no-fix here as duplicate"
---

# UX: plan browse non-TTY dumps a full plan body without browser chrome

## Summary

plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or explicit non-interactive fallback message.

## Evidence

```bash
$ poe-code plan browse
┌   Poe - plan browser
# full markdown body of a plan…
```

## Why it matters

Looks like accidental dump; users cannot browse interactively and get no next-step guidance.

## Suggested direction

Non-TTY: error requiring TTY, or print plan list with hint to plan view <path> / plan list.

## Severity

Medium

## Area

Plan browser
