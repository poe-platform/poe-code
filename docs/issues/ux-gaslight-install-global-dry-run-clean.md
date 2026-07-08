# UX: gaslight install --global --dry-run is clean (positive)

## Summary

gaslight install --global --dry-run: Would create path; Would install; no filesystem changes — intentional dry-run.

## Evidence

Would create: ~/.poe-code/gaslight.yaml; # no filesystem changes

## Why it matters

Positive dry-run pattern to extend elsewhere.

## Suggested direction

Keep; apply to code-review install.

## Severity

Low

## Area

Gaslight / positive pattern
