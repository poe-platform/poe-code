---
severity: low
impact: none
comment: "Positive pattern; its value is as a control for the sonnet-5 cluster - codex with a live frontier model works, so the failures elsewhere are the dead default rather than the spawn path. Consolidate with the other spawn-works positives into one note; its stdin caveat belongs to ux-spawn-codex-reads-stdin-message-on-tty-less-success.md."
---

# UX: spawn codex with gpt-5.3-codex works (positive)

## Summary

spawn codex --model openai/gpt-5.3-codex succeeds (with stdin reading message residual).

## Evidence

spawn codex → ✓ agent: ok; Resume: codex resume …

## Why it matters

Positive codex path with live frontier model.

## Suggested direction

Keep; clean up stdin message if spurious.

## Severity

Low

## Area

Spawn / positive pattern
