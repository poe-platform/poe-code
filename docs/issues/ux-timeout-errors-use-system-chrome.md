---
severity: medium
impact: usability
comment: "Contentless duplicate of ux-activity-timeout-ms-uses-system-chrome.md; retire into it (or into the systemic UserError issue). A timeout is an expected operational condition, so system chrome plus a log pointer is the wrong presentation - the message itself is already correct."
reproduced: y
recommendation: no-fix
evidence: "Behaviour still real - packages/agent-harness-tools/src/run-poe-command.ts:635-638 throws a plain Error (name ActivityTimeoutError) and src/cli/bootstrap.ts:71-81 adds 'Error:' plus 'See logs at ...' for non-CliError/UserError - but this file is a contentless duplicate of ux-activity-timeout-ms-uses-system-chrome.md (reproduced=y, recommendation=fix), so fix tracking belongs there."
---

# UX: timeouts system chrome

## Summary

0.001s + See logs.

## Evidence

activity-timeout-ms 1.

## Why it matters

Operational.

## Suggested direction

User error format.

## Severity

Medium

## Area

Spawn / timeouts
