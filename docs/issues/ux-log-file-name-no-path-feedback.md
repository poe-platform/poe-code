---
severity: medium
impact: usability
comment: "Keep as canonical for the log-path feedback gap and absorb ux-log-dir-relative-works-with-path-feedback-gap.md. Its concrete finding is better than the title suggests: the file lands in ~/.poe-code/spawn-logs/ rather than the ~/.poe-code/logs/ the user expected, and nothing prints the location - so the flag appears to have failed. Printing the resolved path fixes the discoverability and would also have exposed ux-log-dir-unwritable-silently-ignored.md."
---

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
