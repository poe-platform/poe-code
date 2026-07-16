---
severity: medium
impact: usability
comment: "Contentless duplicate within the traces fs-error cluster; retire. Four files for one missing-file error on one command is count inflation."
reproduced: y
recommendation: no-fix
evidence: "Behaviour exists but is a duplicate of canonical ux-traces-enoent-eisdir-still-system-errors.md: loader.ts:326 readFile has no existence check; probe 'npm run dev -- traces /missing.jsonl' prints 'Error: ENOENT: no such file or directory, open '/missing.jsonl'' plus 'See logs at ...errors.log'."
---

# UX: traces missing file ENOENT

## Summary

System chrome.

## Evidence

traces /missing.

## Why it matters

Normal mistake.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Traces
