---
severity: medium
impact: usability
comment: "Keep of this pair. Valid: an invalid --resume-thread-id produces Claude Code's own long usage text about UUIDs and session titles, so the error speaks a vocabulary poe-code never introduced and blames a flag the user did not type. Its fix is right and cheap where the format is known (validate the UUID shape early); where it is not, wrapping the agent error with context about which poe-code flag caused it is the minimum. Same passthrough family as the raw git errors in ux-github-cwd-clone-errors-still-raw-git.md."
---

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
