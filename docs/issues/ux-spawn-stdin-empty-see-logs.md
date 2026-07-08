# UX: empty --stdin prompt has See logs

## Summary

spawn --stdin with empty stdin: No prompt provided via argument or stdin + See logs — good message, system chrome.

## Evidence

```bash
$ echo -n "" | poe-code spawn claude --mode read --model haiku --stdin
■  Error: No prompt provided via argument or stdin
●  See logs …
```

## Why it matters

ValidationError without logs.

## Suggested direction

UserError; suggest prompt arg or non-empty stdin.

## Severity

Medium

## Area

Spawn
