---
severity: medium
impact: usability
comment: "Third filing of the wrong recovery hint ('read-markdown' does not exist); retire into ux-markdown-read-section-wrong-recovery-command.md. No new evidence beyond a second section name."
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
