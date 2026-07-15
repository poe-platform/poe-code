---
severity: medium
impact: usability
comment: "Contentless duplicate within the GitHub 401 cluster; retire. Its 'wrong auth surface' framing is the sharpest three words in the cluster: poe-code's own auth is fine, the failure is GitHub's, and nothing in the message tells users which credential system to fix."
---

# UX: tasks GitHub 401 raw JSON

## Summary

tasks get raw GraphQL 401.

## Evidence

tasks get abc.

## Why it matters

Wrong auth surface.

## Suggested direction

User error + gh auth.

## Severity

Medium

## Area

Tasks / auth
