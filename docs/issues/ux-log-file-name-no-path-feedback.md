# UX: --log-file-name succeeds without showing written path

## Summary

spawn … --log-file-name ux-probe.jsonl succeeds but file not at ~/.poe-code/logs/ux-probe.jsonl — no path feedback; writes under ~/.poe-code/spawn-logs/ (found post-hoc) without telling the user.

## Evidence

spawn with --log-file-name → success; file at ~/.poe-code/spawn-logs/ux-probe.jsonl
(not under logs/, not printed).

## Why it matters

Users cannot find custom log files.

## Suggested direction

Print log path on spawn complete; document default dir.

## Severity

Medium

## Area

Spawn / logging
