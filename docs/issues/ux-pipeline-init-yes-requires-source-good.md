# UX: pipeline init --yes without source is clear (positive)

## Summary

Provide --source or --sources when using --yes is clear non-TTY guidance.

## Evidence

```bash
$ poe-code pipeline init "do something" --yes
■  Provide --source or --sources when using --yes.
```

## Why it matters

Positive non-TTY contract message (still Problems-before-error lifecycle).

## Suggested direction

Keep message; fix panel lifecycle.

## Severity

Low

## Area

Pipeline / positive pattern
