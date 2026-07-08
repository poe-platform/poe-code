# UX: skill bridge failure lists searched paths (positive with chrome)

## Summary

Failed to bridge active skills lists Not found skill references and searched paths — good recovery content (still See logs + panel lifecycle).

## Evidence

```bash
$ poe-code spawn … --skill not-a-skill
■  Error: Failed to bridge active skills: 1 skill reference(s) could not be resolved.
│  Not found skill references.
│  - not-a-skill
│  searched paths:
│  - …/.poe-code/skills/not-a-skill
│  - ~/.poe-code/skills/not-a-skill
```

## Why it matters

Positive recovery detail pattern.

## Suggested direction

Keep paths; drop See logs; ValidationError.

## Severity

Low

## Area

Spawn / positive pattern
