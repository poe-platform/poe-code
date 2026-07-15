---
severity: medium
impact: usability
comment: "Contentless instance of the bare-throw ENOENT family; retire into the shared path-validation issue (ux-mcp-servers-missing-file-almost-good.md proposes the helper). Its 'preflight unfriendly' note is fair - a validate command failing with a system error on a missing file is particularly incongruous, since checking things is its entire purpose."
---

# UX: pipeline validate missing ENOENT

## Summary

System chrome.

## Evidence

validate /tmp/nope.

## Why it matters

Preflight unfriendly.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Pipeline
