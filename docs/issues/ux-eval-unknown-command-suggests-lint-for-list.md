---
severity: medium
impact: usability
comment: "Small but genuinely interesting, and it complicates the did-you-mean cluster: suggestions already exist here and produce a semantically useless answer ('list' -> 'lint'), which is evidence that simply propagating edit-distance suggestions to the root command (ux-command-not-found-no-suggestions.md, ux-toolcraft-has-suggestions-poe-code-root-does-not.md) is not sufficient. Read together, distance matching needs an alias map (list -> report) and a floor for meaningless matches. Keep as the counterexample."
reproduced: y
recommendation: fix
evidence: "npm run dev -- eval list prints 'Unknown command \"list\".' + 'Did you mean: lint?'; eval children are run/report/init/check/lint (packages/agent-eval/src/cli/commands.ts:334-340) and packages/toolcraft/src/suggest.ts:12 sets threshold=max(1,floor(4/4))=1, so damerau distance('list','lint')=1 passes with no semantic check"
---

# UX: eval list unknown command suggests lint (odd Did you mean)

## Summary

eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match without semantic sense).

## Evidence

```bash
$ poe-code eval list
■  Unknown command "list".
│  Did you mean: lint?
```

## Why it matters

Shows toolcraft suggestions can be semantically wrong even when distance-close.

## Suggested direction

Prefer semantic aliases (list→report) or suppress distant/meaningless suggestions; document real commands.

## Severity

Medium

## Area

Eval / suggestions
