---
severity: medium
impact: discoverability
comment: "Instance of the global-flags-not-listed family (ux-global-flags-hidden-on-subcommand-help.md); retire into it. Note the irony that --yes has real semantics here beyond accepting defaults: ux-pipeline-init-yes-requires-source-good.md shows it changes what is required, which argues for documenting it per command rather than only globally."
---

# UX: pipeline init --help omits --yes

## Summary

pipeline init help has agent/model/source/sources only — no --yes for non-TTY generator runs.

## Evidence

pipeline init Options: --agent, --model, --source, --sources, -h

## Why it matters

Non-TTY init needs --yes.

## Suggested direction

Document --yes.

## Severity

Medium

## Area

Pipeline
