# UX: --log-content help underwarns sensitive data (reconfirmed)

## Summary

Help only says Include message and tool content in ACP JSONL spawn logs without security warning; default redacts but flag opts into content.

## Evidence

spawn --help: --log-content Include message and tool content…

## Why it matters

Reconfirm of log-content underwarn.

## Suggested direction

Add (may include secrets/PII) to help; warn at runtime once.

## Severity

Medium

## Area

Spawn / security
