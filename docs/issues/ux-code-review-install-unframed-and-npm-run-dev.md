---
severity: high
impact: polish
comment: "Third filing of the same install output, bundling wrapping, the missing panel and the npm run dev usage line. Retire into ux-code-review-install-output-unframed-wrapped.md (presentation) and ux-code-review-install-no-dry-run-force-writes.md (--dry-run); the npm run dev half belongs to the CLI-wide identity cluster. Its High rating is out of line with the Medium twins for identical output; normalise."
---

# UX: code-review install is unframed + npm run dev help

## Summary

code-review install --force prints unframed "Install repo-local…" and broken word-wrapped absolute paths for Created files; help Usage npm run dev. No design-system panel.

## Evidence

```bash
$ poe-code code-review install --force
Install repo-local code review profiles and prompts.
Lists
Created      /Users/…/.poe-code/code-review/profiles/gen
             eric.md, …/pro
             mpts/orchestrator.md  # path wrapping breaks filenames
```
Help: Usage: npm run dev -- code-review install

## Why it matters

Broken path wrapping confuses success paths; identity leak; outside design-system.

## Suggested direction

Design-system success list with unwrapped paths; displayBinaryName; --dry-run.

## Severity

**High**

## Area

Code-review
