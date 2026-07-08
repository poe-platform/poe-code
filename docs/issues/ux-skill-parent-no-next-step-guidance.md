# UX: bare `skill` only dumps help with no next-step guidance

## Summary

poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding path (skill configure after configure).

## Evidence

```bash
$ poe-code skill
# Commands: install, configure, unconfigure only
```

## Why it matters

First-time skill users need "configure directories for agent X" guidance.

## Suggested direction

Add next-step blurb or default to configure in TTY; examples on help.

## Severity

Medium

## Area

Skills / first-run
