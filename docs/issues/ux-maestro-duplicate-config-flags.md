---
severity: low
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:640-641 maestro tui defines --config <path> and --workflow <path> both described 'Path to WORKFLOW.md', both collapsing to workflowPath at program.ts:648-650"
comment: "Contentless duplicate within the maestro --config/--workflow trio; retire into ux-maestro-config-vs-workflow-flags-duplicated.md. Its one-line diagnosis is the most likely explanation and worth carrying: this looks like an unfinished rename, which argues for deleting one flag rather than designing an alias."
---

# UX: maestro tui duplicate flags

## Summary

--config and --workflow same.

## Evidence

maestro tui --help.

## Why it matters

Unfinished rename.

## Suggested direction

One flag.

## Severity

Low

## Area

Maestro
