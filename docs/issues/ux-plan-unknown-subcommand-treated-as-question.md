---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:526 declares .argument('[question]'); :538-540 routes any non-empty positional to resolvePlanSessionAgent, which throws at :879 'Plan session agent selection requires --agent or --yes...'; no subcommand-suggestion path exists"
comment: "Good observation and the sharpest statement of the plan root-command problem: 'plan foobar' is interpreted as a draft question, so a typo of list/view/archive produces an agent-selection error rather than a did-you-mean. That is the cost of a permissive positional on a group command. Its fix is right and pairs with the did-you-mean cluster. Incidentally its evidence is the cleanest proof that a non-TTY guard exists on this path - relevant to the hang claim in ux-plan-question-non-tty-may-hang.md."
---

# UX: plan foobar treated as plan question not unknown subcommand

## Summary

plan foobar non-TTY: Plan session agent selection requires --agent or --yes — foobar is treated as a plan question draft, not unknown command. Users typo-ing subcommands get agent-selection errors.

## Evidence

```bash
$ poe-code plan foobar
■  Plan session agent selection requires --agent or --yes when running without an interactive TTY.
```

## Why it matters

Typos of list/view/archive become draft-plan flows; confusing.

## Suggested direction

If arg matches known subcommand fuzzy, suggest; else require --yes for draft or list subcommands first.

## Severity

Medium

## Area

Plan
