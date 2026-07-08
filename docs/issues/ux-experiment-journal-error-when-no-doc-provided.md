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
