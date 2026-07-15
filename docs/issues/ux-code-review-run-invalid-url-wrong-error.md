---
severity: high
impact: usability
comment: "Best code-review filing in this set and genuinely distinct: the defect is validation order, not copy. 'not-a-url' reports 'No code-review agent resolved', so the user is sent to fix agent configuration when the real problem is the argument they just typed - a misdiagnosis that costs real time. High is right. Validate prUrl shape before agent resolution; the --debug tease and npm run dev line belong to their own clusters, not here."
---

# UX: code-review run with invalid URL reports agent not configured first

## Summary

code-review run "not-a-url" fails with No code-review agent resolved rather than invalid PR URL — validation order wrong; also --debug stack tease and toolcraft identity on help.

## Evidence

```bash
$ poe-code code-review run "not-a-url"
■  No code-review agent resolved; configure codeReview.agent or …
Use --debug for a stack trace.
```

## Why it matters

Users fix agent config when the real issue is URL/format.

## Suggested direction

Validate prUrl first; ValidationError for URL; then agent resolution.

## Severity

**High**

## Area

Code-review
