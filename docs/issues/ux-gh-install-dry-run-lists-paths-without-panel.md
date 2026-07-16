---
severity: medium
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/github-workflows/src/commands.ts:328 hardcodes 'Installed ${result.installations.length} workflows.' ignoring result.dryRun, and :330 prints bare installation.workflowPath with no dry-run label or panel framing"
comment: "Worse than a framing nit and worth keeping: the output is unlabelled, so users cannot tell a dry-run from a real write - and for a command that writes workflow files into .github/, that is a safety concern rather than cosmetics. Overlaps ux-gh-install-preview-without-dry-run-flag.md, which notes --dry-run is not even in help. Merge and fix as one: label the preview explicitly and document the flag."
---

# UX: gh install --dry-run lists paths without design-system panel

## Summary

github-workflows install --dry-run prints bare workflow paths and would write messages without panel framing; unclear if dry-run or real.

## Evidence

```text
/Users/…/.github/workflows/poe-code-fix-vulnerabilities.yml
…
Shared variables would be written to …
Command reference would be written to …
```

## Why it matters

Dry-run should be explicitly labeled and framed.

## Suggested direction

Design-system dry-run list with Dry run: prefix.

## Severity

Medium

## Area

GitHub workflows
