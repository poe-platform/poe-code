---
severity: medium
impact: usability
comment: "Third filing of the wrong recovery hint ('read-markdown' does not exist); retire into ux-markdown-read-section-wrong-recovery-command.md. No new evidence beyond a second section name."
reproduced: y
recommendation: no-fix
evidence: "Behaviour real but duplicate: packages/markdown-reader/src/core/resolve.ts:35 emits \"try 'read-markdown'\" while the registered CLI command is 'markdown-read'; already tracked as fix in ux-markdown-read-section-wrong-recovery-command.md"
---

# UX: markdown-read-section still suggests read-markdown (reconfirmed)

## Summary

Reconfirmed: no section matching still says try read-markdown (wrong command name).

## Evidence

```bash
$ poe-code plan markdown-read-section … "ZZZ"
■  Error: no section matching "ZZZ" (try 'read-markdown' to see the table of contents)
```

## Why it matters

Reconfirm wrong recovery command.

## Suggested direction

Suggest plan markdown-read <file>.

## Severity

Medium

## Area

Plan
