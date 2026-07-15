---
severity: low-medium
impact: usability
comment: "Minor but legitimate: --archive and --no-archive are peer options in help and passing both silently resolves via Commander's last-wins negation, so the user cannot tell which behavior they got - and for a flag controlling whether files are archived, silence is the wrong default. Given ux-gaslight-mode-read-still-mutated-plans-dir.md shows archiving already happens when it should not, clarity matters more here than Low-Medium suggests. Reject the conflict or document last-wins."
---

# UX: gaslight accepts --archive and --no-archive together without conflict error

## Summary

Passing both --archive and --no-archive does not error; one silently wins (Commander negate) while help lists both as peer options.

## Evidence

gaslight --archive --no-archive --yes … proceeds to run (fails later on model) without "use only one" error.

## Why it matters

Conflicting flags should fail fast with clear message.

## Suggested direction

Reject both set; or document last-wins explicitly in help.

## Severity

Low–Medium

## Area

Gaslight
