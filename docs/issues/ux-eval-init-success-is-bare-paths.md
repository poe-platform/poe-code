# UX: eval init success is bare path lines without design-system framing

## Summary

eval init prints folder name and next: poe-code eval check … as bare lines; also next command may still be under npm run dev identity in other eval errors.

## Evidence

```bash
$ poe-code eval init ux-audit-eval --kind plan
ux-audit-eval
next: poe-code eval check ux-audit-eval
```

## Why it matters

Success should confirm what was created (files) in product framing.

## Suggested direction

Design-system success with file list and next steps.

## Severity

Low–Medium

## Area

Eval
