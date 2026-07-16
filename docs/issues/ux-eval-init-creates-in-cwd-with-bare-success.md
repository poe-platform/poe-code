---
severity: low-medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "packages/agent-eval/src/cli/init.ts:16 resolves sourceDir from process.cwd(); lines 25-26 write bare relative dir and 'next:' line via process.stdout.write with no design-system formatting or created-path list"
comment: "Second of four eval init filings; retire into ux-eval-init-prints-bare-name-and-cwd-default-confusing.md. Its incidental observation is worth carrying: repeated eval init runs during the audit left untracked directories behind - a process note about probe pollution rather than a product defect."
---

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
