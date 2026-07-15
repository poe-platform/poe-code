---
severity: low-medium
impact: usability
comment: "Duplicate within the plan view JSON trio; retire. Its framing is the fairest of the three - the content field is genuinely useful for tooling, so the ask is documentation plus a metadata-only mode rather than removing it - and that nuance should survive the merge."
---

# UX: plan view --output json dumps entire markdown content field

## Summary

plan view --output json includes a huge content string of the full plan body, which is useful for tooling but floods terminals when users experiment with --output json expecting metadata-only.

## Evidence

```bash
$ poe-code plan view docs/plans/32-agent-goal.md --output json
{ "kind":"plan", "path":"…", "content": "<entire multi-kb markdown>" }
```

## Why it matters

JSON mode should document full body inclusion; optional --metadata-only for list-like fields.

## Suggested direction

Document content field; add --no-content or metadata mode for scripting.

## Severity

Low–Medium

## Area

Plan view
