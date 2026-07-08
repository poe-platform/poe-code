# UX: gaslight install --force overwrites without showing prior content

## Summary

gaslight install --local --force overwrites gaslight.yaml and says Installed without dry-run of content change or backup; without --force says already exists (good).

## Evidence

```bash
$ poe-code gaslight install --local
◆  Gaslight config already exists (local).
$ poe-code gaslight install --local --force
●  Create: …/gaslight.yaml
◆  Installed Gaslight config (local).
```

## Why it matters

Force overwrite without backup/diff is risky for customized gaslight.yaml.

## Suggested direction

Backup before force; show would overwrite; --dry-run with --force.

## Severity

Medium

## Area

Gaslight
