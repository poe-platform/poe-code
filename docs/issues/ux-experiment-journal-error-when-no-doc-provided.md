---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- experiment journal (no doc) prints 'No markdown doc found under docs/plans. Provide a doc path.' while experiment --help lists 'journal [doc]' as optional; src/cli/commands/experiment.ts:599-602 throws ValidationError when discoverExperimentDocs returns none, and packages/experiment-loop/src/discovery/discovery.ts:29-35 filters kinds: [experiment], so the message is kind-unaware."
comment: "Sharpest filing in the kind-unaware cluster and genuinely distinct: it identifies a contract contradiction the others miss - help advertises [doc] as optional, so omitting it should do something sensible, yet it errors and then instructs the user to supply the argument help called optional. That reframes the fix as a choice: implement the discovery the optional arg implies (list experiment journals, as plan list does) or mark it required. Keep as canonical for the [doc] contract; the wrong-message half belongs to ux-experiment-ralph-no-doc-wrong-message.md."
---

# UX: experiment journal shows confusing error when [doc] arg is omitted

## Summary

`experiment journal [doc]` lists `[doc]` as an optional argument in `experiment --help`. However, running `poe-code experiment journal` without a doc path produces:

```
■  No markdown doc found under docs/plans. Provide a doc path.
```

The error is confusing because:
1. The help implies `[doc]` is optional — but omitting it causes an error.
2. "No markdown doc found under docs/plans" suggests it searched a directory automatically, but it couldn't find one — users do not know what structure docs/plans requires.
3. The instruction "Provide a doc path" contradicts the optional-arg signal from `[doc]`.

## Why it matters

A user who reads `experiment journal [doc]` will reasonably omit the arg expecting a default view (e.g. list of all experiment journals), and get a confusing error with no actionable next step beyond the vague "Provide a doc path."

## Suggested direction

Either:
- Make the auto-discovery actually work (list all experiment journals found, like `plan list` does), or
- Change `[doc]` to `<doc>` (required) in the help, and give a clear error like: "Specify a path to an experiment markdown doc, e.g. `poe-code experiment journal docs/plans/my-experiment.md`"

## Severity

Medium

## Area

Experiment / journal / error message / discoverability
