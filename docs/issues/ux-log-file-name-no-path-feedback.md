# UX: --log-file-name succeeds without showing written path

## Summary

spawn … --log-file-name ux-probe.jsonl succeeds but file not at ~/.poe-code/logs/ux-probe.jsonl — no path feedback; may write under cwd or agent log dir silently.

## Evidence

spawn with --log-file-name → success; ~/.poe-code/logs/ux-probe.jsonl missing.

## Why it matters

Users cannot find custom log files.

## Suggested direction

Print log path on spawn complete; document default dir.

## Severity

Medium

## Area

Spawn / logging
