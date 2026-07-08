# UX: plan view --output json embeds entire plan content flood

## Summary

plan view pipeline plan --output json includes full content string of the entire plan body (thousands of chars) plus metadata — unusable machine JSON flood for large plans.

## Evidence

```bash
$ poe-code plan view docs/plans/tiny-http-mcp-server-production-hardening.md --output json
{"kind":"pipeline",…,"content":"# tiny-http… <entire plan body>"}
```

## Why it matters

JSON consumers expect metadata; full content should be opt-in.

## Suggested direction

Default JSON: path/title/status/tasks summary; --include-content for body.

## Severity

**High**

## Area

Plan
