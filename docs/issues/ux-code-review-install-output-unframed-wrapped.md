# UX: code-review install success is unframed and path-wrapped badly

## Summary

code-review install prints Lists Created with hard-wrapped absolute paths mid-word without design-system panel — hard to read.

## Evidence

```text
Created      /Users/…/.poe-code/code-review/profiles/gen
             eric.md, /Users/…/pro
             mpts/orchestrator.md, …
```

## Why it matters

Broken wrapping looks like corruption; toolcraft group.

## Suggested direction

Design-system file list one path per line.

## Severity

Medium

## Area

Code-review
