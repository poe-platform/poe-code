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
