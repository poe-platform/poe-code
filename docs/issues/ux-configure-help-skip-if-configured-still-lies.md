# UX: configure --help still claims skip-if-configured exits without writes (reconfirmed)

## Summary

configure --help: --skip-if-configured Exit without writes when current config already matches — help still lies (Critical #12).

## Evidence

--skip-if-configured  Exit without writes when current config already matches

## Why it matters

Reconfirm Critical help lie still present.

## Suggested direction

Truthful help: skip only when fully matching; dry-run shows would skip.

## Severity

**High**

## Area

Configure / help
