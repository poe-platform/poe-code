---
severity: medium
impact: usability
comment: "One of three filings of the --cwd path error chrome; consolidate. All three concede the message is already correct, so they collapse into ux-user-errors-look-like-system-failures.md. Note the positives ux-cwd-file-path-not-directory-good.md and ux-cwd-missing-path-good-message.md praise these same messages - the split is purely message-good/chrome-bad, filed twice from each side."
---

# UX: spawn --cwd file (not dir) has See logs

## Summary

spawn --cwd /tmp/file: Workspace path is not a directory + See logs — clear message, system chrome.

## Evidence

Workspace path "…" is not a directory.
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; path must be a directory.

## Severity

Medium

## Area

Spawn
