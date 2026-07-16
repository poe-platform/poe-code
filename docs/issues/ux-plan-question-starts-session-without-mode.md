---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- plan test plan question => 'error: too many arguments for plan. Expected 1 argument but got 3.'; src/cli/commands/plan.ts:445 declares single [question] arg with no allowExcessArguments and addHelpText at plan.ts:456 shows only explorer keymap, no quoting example"
comment: "Keep of this pair as the more concrete filing. Two findings: unquoted multi-word input fails with 'too many arguments' (a real papercut with an obvious fix - suggest quoting), and the non-TTY draft contract is undocumented. The quoting hint is the cheap win; the contract half overlaps ux-plan-question-non-tty-may-hang.md, whose hang claim conflicts with the session start seen here."
---

# UX: plan "question" starts agent session with unclear non-TTY contract

## Summary

plan "test plan question only" --yes printed What do you want to build? and began session — multi-word without quotes errors too many arguments; interactive plan draft path poorly documented for CI.

## Evidence

```bash
$ poe-code plan test plan question  # too many arguments
$ poe-code plan "test plan question only" --yes
What do you want to build?
```

## Why it matters

Plan drafting UX is confusing for scripts.

## Suggested direction

Document quotes; non-TTY require --yes and complete; Examples in help.

## Severity

Medium

## Area

Plan
