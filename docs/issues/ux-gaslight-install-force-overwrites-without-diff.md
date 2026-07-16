---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/gaslight.ts:288-303 scaffoldConfig stats existing path, and when force is set falls through to writeFile of GASLIGHT_CONFIG_EXAMPLE with no backup or diff; line 445 always prints 'Would create'/'Create' even when overwriting."
comment: "Real data-loss risk, understated at Medium: --force silently overwrites a possibly hand-customised gaslight.yaml with no backup, no diff and no preview of what is lost, and its dry-run misreports the operation as a create (ux-gaslight-install-force-dry-run-vs-already-exists.md). Merge the pair: back up before overwrite and say 'would overwrite'. The no-force 'already exists' path is correct and is the good half worth preserving."
---

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
