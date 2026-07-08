# UX: gaslight install --force --dry-run still plans create while without force says already exists

## Summary

gaslight install --local --force --dry-run says Would create gaslight.yaml; without --force dry-run says already exists — force dry-run may lie if file exists (overwrite not shown as overwrite).

## Evidence

```bash
$ poe-code gaslight install --local --force --dry-run
●  Would create: …/gaslight.yaml
$ poe-code gaslight install --local --yes --dry-run
●  Gaslight config already exists (local).
```

## Why it matters

Dry-run force should say would overwrite, not would create.

## Suggested direction

Detect exists; force → would overwrite; else already exists.

## Severity

Medium

## Area

Gaslight
