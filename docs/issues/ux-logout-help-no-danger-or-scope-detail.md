# UX: logout --help does not warn of full factory-reset scope

## Summary

logout help only says Remove all configuration and credentials with no file list, agent impact, or confirmation policy.

## Evidence

```text
Usage: poe-code logout [options]
Remove all configuration and credentials.
```

## Why it matters

Destructive command help must state blast radius.

## Suggested direction

List actions; require --yes in non-TTY; confirm on TTY; split credentials vs reset.

## Severity

**High**

## Area

Auth / destructive
