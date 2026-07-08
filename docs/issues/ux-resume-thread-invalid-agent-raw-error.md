# UX: invalid --resume-thread-id surfaces agent raw error

## Summary

spawn --resume-thread-id not-a-real-id fails with long Claude Code usage text about UUID/session title + See logs — not ValidationError at poe-code layer.

## Evidence

--resume requires a valid session ID… Provided value "not-a-real-id" is not a UUID…

## Why it matters

Invalid resume id should fail early with UserError.

## Suggested direction

Validate UUID format when possible; UserError without logs.

## Severity

Medium

## Area

Spawn
