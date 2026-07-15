---
severity: critical
impact: discoverability
comment: "Critical is not defensible for a help usage line when this audit rates real data loss the same, and its severity is inconsistent with the five sibling filings of the identical leak (Medium/High). Retire into ux-development-mode-usage-intentional-but-leaks.md, which names the mechanism and the fix. Its reasoning is the best-articulated in the identity cluster though - installed users are told to run a developer script, and the resulting error has nothing to do with the command they wanted - so carry that argument across. Note the caveat from ux-root-help-usage-still-npm-run-dev-reconfirmed.md: the leak may only appear when run via tsx, which if true removes the premise entirely."
---

# UX: superintendent help shows "npm run dev --" instead of "poe-code" in Usage

## Summary

`superintendent --help` and `superintendent run --help` both render the Usage line as `npm run dev -- superintendent ...` — exposing the internal dev-server invocation pattern instead of the installed CLI name `poe-code`.

## Evidence

```
Usage: npm run dev -- superintendent [command] [OPTIONS]
```
```
Usage: npm run dev -- superintendent run [OPTIONS] [doc]
```

Every other command shows `poe-code <command> [options]`.

## Why it matters

Critical user confusion: install users are told to invoke `npm run dev --` which is a developer-only script and will fail for anyone who installed via npm. The error message they get when they follow the usage example has nothing to do with superintendent.

## Suggested direction

Ensure the superintendent command (and its subcommands) derive their binary name from the CLI framework's `$0` / `argv[0]` the same way every other command does.

## Severity

Critical

## Area

Superintendent / help / usage line
