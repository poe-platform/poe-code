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
