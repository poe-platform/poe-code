---
severity: low
impact: none
comment: "Positive pattern: 'Provide --source or --sources when using --yes' names the flag, the alternatives and the trigger condition. Its value beyond the copy is documenting that --yes changes the required-argument contract, which belongs in help (ux-pipeline-init-help-omits-yes.md). Its lifecycle caveat belongs to ux-error-panel-closes-before-error.md."
---

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
