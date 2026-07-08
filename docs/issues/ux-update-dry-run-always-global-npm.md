# UX: update --dry-run always plans global npm install (positive-ish)

## Summary

update --dry-run plans npm install -g poe-code@latest — clear dry-run (always -g; package-manager override exists).

## Evidence

Dry run: would run npm install -g poe-code@latest.

## Why it matters

Positive dry-run command echo; global-only remains an issue.

## Suggested direction

Keep dry-run; document global-only; support local monorepo skip.

## Severity

Low

## Area

Update / positive pattern
