---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- superintendent validate docs/plans/32-agent-goal.md (kind: plan) prints 'Superintendent document is invalid (1 error). - Error: Unclosed tag'; message originates in packages/toolcraft-design/src/components/template.ts:207 during resolveSuperintendentDoc extends resolution (packages/superintendent/src/document/parse.ts:293), so the kind check at parse.ts:436 is never reached"
comment: "Keep as canonical of the Unclosed-tag trio. Real and worth High: validate is handed a plan-kind file and reports a parse error rather than a kind mismatch, so the user hunts a malformed tag in a document that is simply the wrong type. Its diagnosis is right - kind should be checked before parsing. The decisive evidence is in-product: ux-superintendent-complete-wrong-kind-debug-tease.md shows complete already reports 'kind must be superintendent' for the same input, so validate is the outlier and the correct check already exists."
---

# UX: superintendent validate on plan says Unclosed tag

## Summary

superintendent validate docs/plans/32-agent-goal.md → Superintendent document is invalid (1 error): Unclosed tag — opaque parse error for wrong kind/doc.

## Evidence

```bash
$ poe-code superintendent validate docs/plans/32-agent-goal.md
■  Superintendent document is invalid …
│  - Error: Unclosed tag
```

## Why it matters

Wrong kind should say kind mismatch not Unclosed tag.

## Suggested direction

Kind-aware validation; map parse errors to actionable messages.

## Severity

**High**

## Area

Superintendent / kind errors
