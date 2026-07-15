---
severity: low-medium
impact: polish
comment: "Fourth filing of the eval init bare-success observation; retire into ux-eval-init-prints-bare-name-and-cwd-default-confusing.md. Its 'confirm what was created' framing is the right ask and should survive: the current output names the eval but never lists the files, so users cannot tell what the scaffold produced."
---

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
