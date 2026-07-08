# UX: spawn --log-content help underwarns sensitive data risk

## Summary

spawn --help: --log-content Include message and tool content in ACP JSONL spawn logs — no danger that logs may contain secrets/prompts.

## Evidence

--log-content  Include message and tool content in ACP JSONL spawn logs

## Why it matters

Users enable content logging without warning about secrets on disk.

## Suggested direction

Warn: may write prompts/secrets to log files; prefer redaction.

## Severity

Medium

## Area

Spawn / security
