---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-spawn-at-file-works.md (failure and success halves of the same feature). Consolidate. The message is good because it names the flag, the path and the underlying cause - the shape the raw ENOENT cluster lacks, and worth citing there as proof the product can do this well."
---

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
