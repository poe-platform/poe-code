# UX: `version` subcommand missing; only -V/--version work

## Summary

poe-code version is Unknown command; version works via -V/--version. Users typing version as subcommand (common pattern) fail.

## Evidence

```bash
$ poe-code version
■  Unknown command: version
$ poe-code --version
# works (version panel)
```

## Why it matters

Common CLI pattern expects version subcommand or alias.

## Suggested direction

Add version command aliasing --version; or Did you mean: --version.

## Severity

Medium

## Area

Version
