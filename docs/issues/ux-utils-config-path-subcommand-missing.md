---
severity: medium
impact: capability-gap
comment: "Keep of this pair (better-specified ask: 'utils config path [--global|--project]' printing absolute paths). Modest but real and cheap: the paths exist inside show's output, so exposing them alone is trivial and serves both scripting and documentation. Precedent already exists - the plan-path commands print a bare path for exactly this purpose."
---

# UX: utils config path is not a subcommand

## Summary

utils config path fails with too many arguments; only show/init/edit exist. Users often need the path without opening an editor.

## Evidence

```bash
$ poe-code utils config path
error: too many arguments for 'config'. Expected 0 arguments but got 1.
```
Commands: show, init, edit.

## Why it matters

Path is a common need for scripting and docs.

## Suggested direction

Add `utils config path [--global|--project]` printing absolute paths.

## Severity

Medium

## Area

Utils / config
