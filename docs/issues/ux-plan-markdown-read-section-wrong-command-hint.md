# UX: plan markdown-read-section error suggests wrong command name

## Summary

When section match fails, error says try read-markdown to see TOC, but the actual command is plan markdown-read (or markdown-read under plan).

## Evidence

```bash
$ poe-code plan markdown-read-section docs/plans/32-agent-goal.md "What"
■  Error: no section matching "What" (try 'read-markdown' to see the table of contents)
●  See logs …
```

## Why it matters

Recovery command is wrong; users type a non-existent command.

## Suggested direction

Suggest `poe-code plan markdown-read <file>`; list close section titles; ValidationError.

## Severity

Medium

## Area

Plan
