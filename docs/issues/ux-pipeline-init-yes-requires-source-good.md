---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:1182 throws ValidationError('Provide --source or --sources when using --yes.') when flags.assumeYes and no source; test at src/cli/commands/pipeline-command.test.ts:1937 asserts it. Positive note, no defect."
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
