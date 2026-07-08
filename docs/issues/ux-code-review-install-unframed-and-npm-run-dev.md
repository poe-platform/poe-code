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
