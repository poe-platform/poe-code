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
