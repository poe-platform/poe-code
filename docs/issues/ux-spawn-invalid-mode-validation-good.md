---
severity: low
impact: none
comment: "Keep of this positive pair as the canonical (a bogus value is the more natural case than empty). Its 'apply across all mode flags' direction is the actionable half and connects to ux-permission-mode-sets-differ-across-commands.md: the validation is good here while the enum itself differs per command, so propagating this message without unifying the enum would spread the inconsistency."
---

# UX: spawn invalid --mode validation is good (positive)

## Summary

Invalid --mode "bogus" returns Expected yolo, auto, edit, or read without Commander raw skin.

## Evidence

```bash
$ poe-code spawn … --mode bogus
■  Invalid --mode "bogus". Expected yolo, auto, edit, or read.
```

## Why it matters

Positive enum validation.

## Suggested direction

Keep; apply across all mode flags.

## Severity

Low

## Area

Spawn / positive pattern
