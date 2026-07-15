---
severity: medium
impact: discoverability
comment: "Retire into ux-readme-features-wrap-but-cli-missing.md, which handles this properly: wrap's removal is intentional, the README was already fixed by a concurrent commit, and the residual risk is external references. Its own ask ('restore wrap') contradicts that resolution and should not survive - the decision is made. A did-you-mean for wrap is the useful mitigation."
---

# UX: wrap command still missing (reconfirmed)

## Summary

wrap remains Unknown command — residual after README wrap removal; muscle memory / external docs.

## Evidence

wrap → Unknown command.

## Why it matters

Reconfirm wrap absence.

## Suggested direction

Remove external docs references; or restore wrap; document alternative.

## Severity

Medium

## Area

Docs / CLI sync
