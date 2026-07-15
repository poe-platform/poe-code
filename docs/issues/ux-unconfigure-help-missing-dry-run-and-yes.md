---
severity: medium
impact: discoverability
comment: "One of three near-identical filings of the unconfigure help gap; consolidate into ux-unconfigure-help-omits-yes-and-dry-run.md. All three make the same fair point: the most destructive per-agent command documents nothing but -h, so users cannot learn --dry-run exists before running it - and the dry-run is exactly what would show them the blast radius."
---

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
