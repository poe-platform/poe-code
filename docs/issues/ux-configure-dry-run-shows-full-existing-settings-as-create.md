# UX: configure dry-run presents full existing settings as create-from-null

## Summary

configure claude dry-run often shows --- /dev/null +++ settings.json with full 145-line content including effortLevel xhigh from existing file merge presentation — looks like creating entire config from scratch even for partial updates; confuses source of xhigh (existing file vs poe-code write).

## Evidence

claude-code configure only merges env + model in source; dry-run still shows full file + with effortLevel xhigh from existing settings.

## Why it matters

Users cannot tell what poe-code will change vs preserve.

## Suggested direction

Intentional-only diff of merge keys; label preserved fields.

## Severity

**High**

## Area

Dry-run
