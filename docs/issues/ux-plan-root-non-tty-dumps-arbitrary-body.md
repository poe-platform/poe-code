---
severity: high
impact: usability
comment: "Keep as canonical of this pair. Its framing is the most useful in the plan non-TTY family because it names the root cause: 'plan' is ambiguous between browse, draft and list, so with no subcommand and no TTY it falls back to dumping something. Fix the ambiguity (list, or require a subcommand) and the browse dump trio resolves with it. Same family as ux-plan-unknown-subcommand-treated-as-question.md - the root command's argument handling is too permissive."
---

# UX: plan (no subcommand) non-TTY dumps arbitrary plan body

## Summary

poe-code plan without question/subcommand in non-TTY dumps full body of some plan (same as browse) — not a list, not an error requiring TTY.

## Evidence

```bash
$ poe-code plan
# dumps toolcraft human-in-loop plan body
```

## Why it matters

Root plan command is ambiguous: browse vs draft vs list.

## Suggested direction

Non-TTY: print plan list or require question/subcommand; never dump arbitrary body.

## Severity

**High**

## Area

Plan / non-TTY
