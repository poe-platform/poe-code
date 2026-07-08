# UX: eval init creates folder in cwd with bare success lines (reconfirm)

## Summary

eval init ux-audit-eval-two creates files with bare name/next lines — reconfirm eval init success framing; also creates untracked dirs if user forgets cleanup.

## Evidence

```bash
$ poe-code eval init ux-audit-eval-two --kind plan
ux-audit-eval-two
next: poe-code eval check ux-audit-eval-two
```

## Why it matters

Reconfirm bare success; design-system file list better.

## Suggested direction

Design-system success with created paths.

## Severity

Low–Medium

## Area

Eval
