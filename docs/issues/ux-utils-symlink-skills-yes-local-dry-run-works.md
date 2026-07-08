# UX: utils symlink skills --yes --local --dry-run works (positive after scope flags)

## Summary

With explicit scope flags, dry-run shows rename+symlink plan — positive once scope is provided (still subject to earlier non-TTY scope friction).

## Evidence

```bash
$ poe-code utils symlink skills --yes --local --dry-run
●  rename .claude/skills -> .agents/skills
●  symlink .claude/skills -> ../.agents/skills
```

## Why it matters

Documents working path; keep with scope-error issue.

## Suggested direction

Allow dry-run without --yes by assuming local default with note.

## Severity

Low

## Area

Utils / positive pattern
