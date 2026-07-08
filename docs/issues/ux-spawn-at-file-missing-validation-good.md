# UX: spawn @missing-file validation is good (positive)

## Summary

spawn @/tmp/no-prompt.txt reports prompt could not read file with path and ENOENT — clear ValidationError style.

## Evidence

```bash
$ poe-code spawn claude @/tmp/no-prompt.txt --mode read …
■  prompt could not read file "/tmp/no-prompt.txt": ENOENT: …
```

## Why it matters

Positive @file error.

## Suggested direction

Keep; drop See logs if present.

## Severity

Low

## Area

Spawn / positive pattern
