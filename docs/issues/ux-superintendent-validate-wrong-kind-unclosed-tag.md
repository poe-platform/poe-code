---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- superintendent validate docs/plans/32-agent-goal.md (kind: plan, line 3) prints 'Superintendent document is invalid (1 error). - Error: Unclosed tag'; thrown at packages/toolcraft-design/src/components/template.ts:207 via resolveSuperintendentDoc (packages/superintendent/src/document/parse.ts:293) before the kind check at parse.ts:436, while superintendent complete on the same file prints 'frontmatter kind must be \"superintendent\"' - duplicate of ux-superintendent-validate-unclosed-tag.md which carries the fix"
comment: "Reconfirm duplicate within the Unclosed-tag trio; retire into ux-superintendent-validate-unclosed-tag.md. Its suggested wording ('Expected superintendent kind, found plan') is the best in the trio and matches what complete already emits."
---

# UX: superintendent validate wrong kind reports Unclosed tag

## Summary

superintendent validate on plan doc: Superintendent document is invalid — Error: Unclosed tag — parser noise not kind mismatch.

## Evidence

Problems: Error: Unclosed tag

## Why it matters

Reconfirm kind-aware doc errors platform fix.

## Suggested direction

Expected superintendent kind, found plan.

## Severity

**High**

## Area

Superintendent
