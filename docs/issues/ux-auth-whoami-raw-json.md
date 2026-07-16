---
severity: low-medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:150 writes JSON.stringify(identity) for whoami while auth.ts:96 stops spinner with 'Logged in as ...' panel; auth.ts:39 already documents whoami as 'Print Poe account identity as JSON' - behaviour exists but is the intended machine contract, and this file duplicates ux-auth-whoami-raw-json-vs-status-panel.md"
comment: "Contentless twin of ux-auth-whoami-raw-json-vs-status-panel.md; retire. Its suggested direction ('human default, --json opt-in') is actively wrong and must not survive the merge: it would break the stable machine contract that ux-auth-whoami-field-shape-good.md and ux-auth-whoami-help-documents-json-good.md both praise, and whoami is already documented as the JSON path."
---

# UX: auth whoami raw JSON

## Summary

JSON vs status design-system.

## Evidence

whoami.

## Why it matters

Inconsistent.

## Suggested direction

Human default --json.

## Severity

Low–Medium

## Area

Auth polish
