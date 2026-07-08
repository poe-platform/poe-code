# UX: --log-content help has no sensitive-data warning

## Summary

spawn --log-content help only says Include message and tool content in ACP JSONL spawn logs — no warning that prompts/tool args may contain secrets.

## Evidence

--log-content description has no danger/sensitive warning.

## Why it matters

Users may enable content logging in CI and leak secrets to disk.

## Suggested direction

Warn in help; default off (already); optional redaction note.

## Severity

Medium

## Area

Spawn / logging
