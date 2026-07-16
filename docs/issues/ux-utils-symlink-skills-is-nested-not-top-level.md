---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/utils-symlink.ts:12,46 registers only nested 'symlink' -> 'skills' with no alias; `npm run dev -- utils symlink-skills` prints \"error: unknown command 'symlink-skills'\" exit 1. README_UTILS.md:65 documents the nested form, so no docs drift."
comment: "Small and fair: symlink-skills is a plausible guess that fails while utils symlink skills works. Same naming-collision family as ux-skill-naming-collisions.md and ux-runtime-jobs-ls-inconsistent-with-list.md - aliases cost nothing and close all three. Its docs-drift concern is the more valuable half: if any documentation uses the hyphenated form, that is the actual bug."
---

# UX: utils symlink-skills is nested under utils symlink skills

## Summary

utils symlink-skills unknown; actual path is utils symlink skills — footgun for muscle memory / docs.

## Evidence

utils symlink-skills → unknown command
utils symlink skills exists

## Why it matters

Command path mismatch causes friction.

## Suggested direction

Alias symlink-skills or document nested path on utils help.

## Severity

Low–Medium

## Area

Utils
