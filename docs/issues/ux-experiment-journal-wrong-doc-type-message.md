---
severity: low-medium
impact: usability
comment: "Contentless ('Doc not found for existing.', 'Wrong kind.'); retire into ux-experiment-journal-wrong-kind-says-not-found.md, which states the same point with a real repro. Rated Low-Medium while its twins are High for identical behavior; the survivor should carry one severity."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/experiment.ts:645 catch-all rethrows any read/parse failure as 'Experiment doc not found', masking packages/experiment-loop/src/frontmatter/frontmatter.ts:364 \"Experiment document kind must be 'experiment'.\"; duplicate of ux-experiment-journal-wrong-kind-says-not-found.md"
---

# UX: experiment journal wrong type

## Summary

Doc not found for existing.

## Evidence

experiment journal plan.

## Why it matters

False missing.

## Suggested direction

Wrong kind.

## Severity

Low–Medium

## Area

Experiment
