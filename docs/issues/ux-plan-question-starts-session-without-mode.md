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
