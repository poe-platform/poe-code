---
severity: medium
impact: usability
comment: "Duplicate of ux-markdown-read-section-wrong-recovery-command.md; consolidate. Same genuinely bad small bug: the hint names 'read-markdown', which does not exist, so the recovery line routes users into an Unknown command error. Its extra suggestion is the better fix and should survive: list close section titles rather than pointing at the TOC command at all - a fuzzy match on 'What' would have found 'What we're building' directly."
---

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
