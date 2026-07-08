# UX: unconfigure --help omits --yes and --dry-run

## Summary

unconfigure help only agent and -h — no --yes/--dry-run despite global dry-run and destructive unconfigure that can print secrets.

## Evidence

unconfigure Options: -h only.

## Why it matters

Destructive command help incomplete; dry-run secret class related.

## Suggested direction

Document --yes, --dry-run, blast radius.

## Severity

**High**

## Area

Unconfigure / help
