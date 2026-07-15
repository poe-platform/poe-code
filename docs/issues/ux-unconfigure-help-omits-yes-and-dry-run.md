---
severity: high
impact: discoverability
comment: "Keep as canonical of the unconfigure help trio - the only one connecting the help gap to the secret leak: users cannot discover --dry-run, and when they do find it, it prints their API keys (ux-unconfigure-goose-dry-run-still-prints-secrets.md). So documenting the flag is worth doing only after the redaction fix, or the documentation points at a leak. Sequence accordingly."
---

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
