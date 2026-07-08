# UX: plan list --output json dumps raw JSON array without framing

## Summary

plan list --output json prints a raw JSON array to stdout with no design-system intro; --output md prints a markdown table. Useful for scripting but inconsistent with --output terminal panel and with --json conventions elsewhere.

## Evidence

```bash
$ poe-code plan list --output json
[ { "kind": "plan", ... }, ... ]
$ poe-code plan list --output md
| Kind | Type | Name | ...
```

## Why it matters

Three output modes; json mode is good for scripts if documented as pure stdout.

## Suggested direction

Document --output; prefer --json alias for consistency with traces/tasks.

## Severity

Low–Medium

## Area

Plan list
