# UX: gaslight install --force --dry-run is clean (positive)

## Summary

gaslight install --local --force --dry-run: Would create path; Would install; no filesystem changes — clean dry-run even with --force.

## Evidence

Would create: …/gaslight.yaml; # no filesystem changes

## Why it matters

Positive force+dry-run pattern (contrast non-dry force overwrite risk).

## Suggested direction

Keep; apply to experiment/pipeline install.

## Severity

Low

## Area

Gaslight / positive pattern
