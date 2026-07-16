---
severity: medium
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/gaslight.ts:290-303 - scaffoldConfig returns changed:true when force and file exists; gaslight.ts:443-446 then logs 'Would create' with no overwrite distinction"
comment: "Good catch and the counterweight to the two 'clean dry-run' positives: --force --dry-run reports 'Would create' for a file that exists, while the same command without --force correctly says 'already exists' - so the preview misdescribes a destructive overwrite as a create. That is a dry-run fidelity bug and it matters more than Medium suggests, given ux-gaslight-install-force-overwrites-without-diff.md shows the real run overwrites with no backup. Merge the two: preview must say 'would overwrite' and the real path should back up."
---

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
