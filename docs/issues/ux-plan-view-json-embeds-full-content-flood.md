---
severity: high
impact: usability
comment: "Keep as canonical of the plan view JSON trio, though High overstates it: nothing breaks, and the content field is arguably correct for a 'view' command - the real complaint is that there is no metadata-only mode, a capability gap rather than a defect. Its proposed default (path/title/status/tasks summary with --include-content for the body) is the right shape. The three filings span Low-Medium to High for identical behavior; normalise."
---

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
