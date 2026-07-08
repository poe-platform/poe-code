# UX: unconfigure --help missing --dry-run and --yes

## Summary

unconfigure help only -h; no --dry-run/--yes though global flags may apply — destructive command underdocumented.

## Evidence

unconfigure Options: -h only.

## Why it matters

Destructive ops need dry-run and confirmation flags in help.

## Suggested direction

Document --dry-run and --yes; require --yes non-TTY.

## Severity

Medium

## Area

Unconfigure
