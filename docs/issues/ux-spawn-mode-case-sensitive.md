---
severity: low-medium
impact: usability
comment: "Real and cheap, and the audit already supplies the argument: models accepts --feature TOOLS and --provider Anthropic case-insensitively (ux-models-feature-tools-case-insensitive-good.md, ux-models-provider-case-insensitive-good.md), so --mode AUTO failing is an internal inconsistency rather than defensible strictness. Normalise to lowercase, and fold into the shared mode enum work since both touch the same parsing."
---

# UX: --mode is case-sensitive (AUTO invalid)

## Summary

spawn --mode AUTO fails Invalid --mode "AUTO". Expected yolo, auto, edit, or read — case-sensitive; users typing AUTO fail.

## Evidence

Invalid --mode "AUTO". Expected yolo, auto, edit, or read.

## Why it matters

Case-insensitive enums are friendlier for CLI.

## Suggested direction

Accept case-insensitive mode; normalize to lower.

## Severity

Low–Medium

## Area

Spawn
