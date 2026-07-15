---
severity: medium
impact: usability
comment: "Contentless, but it points at the panel-lifecycle bug that ux-error-panel-closes-before-error.md owns: the Problems footer renders before the error. Retire into that; the pipeline-specific half (the validation message) is already covered as a positive in ux-pipeline-init-yes-requires-source-good.md."
---

# UX: pipeline init panel lifecycle

## Summary

Good validation Problems first.

## Evidence

pipeline init --yes.

## Why it matters

Lifecycle cluster.

## Suggested direction

Fix finalize.

## Severity

Medium

## Area

Pipeline
