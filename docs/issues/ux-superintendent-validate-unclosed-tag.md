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
