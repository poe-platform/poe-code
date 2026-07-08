# UX: memory cache clear --help still omits --yes (reconfirmed)

## Summary

memory cache clear help has --older-than and -h only; prior probe required --yes for clear. Help gap remains.

## Evidence

memory cache clear Options: --older-than, -h only

## Why it matters

Reconfirm destructive help gap for cache clear.

## Suggested direction

Document --yes; refuse without --yes non-TTY.

## Severity

Medium

## Area

Memory
