# UX: plan browse non-TTY dumps a full plan body without browser chrome

## Summary

plan browse without a TTY prints a full rendered plan (first/selected) rather than an error, list, or explicit non-interactive fallback message.

## Evidence

```bash
$ poe-code plan browse
┌   Poe - plan browser
# full markdown body of a plan…
```

## Why it matters

Looks like accidental dump; users cannot browse interactively and get no next-step guidance.

## Suggested direction

Non-TTY: error requiring TTY, or print plan list with hint to plan view <path> / plan list.

## Severity

Medium

## Area

Plan browser
