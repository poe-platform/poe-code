---
severity: high
impact: discoverability
comment: "Duplicate within the missing-examples family; retire into ux-primary-commands-still-lack-examples.md. Its concrete example list (read-mode one-shot, @file, --yes) is the most useful in the family and should survive - notably @file is otherwise undiscoverable (ux-spawn-at-file-works.md)."
---

# UX: spawn --help still has no Examples section

## Summary

spawn --help lists many advanced flags but no Examples for common flows (read mode one-shot, @file, --yes).

## Evidence

spawn --help: Options only; no Examples block (contrast models --help).

## Why it matters

Primary command lacks copy-paste onboarding.

## Suggested direction

Add Examples: spawn claude "…" --mode read; @file; --yes.

## Severity

**High**

## Area

Help / spawn
