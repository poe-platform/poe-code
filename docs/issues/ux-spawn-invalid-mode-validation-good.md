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
