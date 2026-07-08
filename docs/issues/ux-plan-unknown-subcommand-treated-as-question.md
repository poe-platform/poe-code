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
