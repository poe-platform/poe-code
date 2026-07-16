---
severity: medium
impact: usability
comment: "Keep as canonical of this pair: a missing --config path is a user error, so a raw ENOENT plus 'See logs' is the wrong presentation. Same bare-throw mechanism as ux-editor-missing-raw-error.md - unvalidated fs access surfacing as system chrome. Its 'suggest gaslight install' recovery is the useful half."
reproduced: y
recommendation: fix
evidence: "packages/agent-gaslight/src/config.ts:110-118 explicit configPath branch calls fs.readFile with no isMissingFile/ENOENT handling (unlike the default-search branch at :129-136), so raw ENOENT escapes; src/cli/commands/gaslight.ts:342 passes options.config straight through unvalidated; src/cli/bootstrap.ts:71-80 prints 'Error: <msg>' plus 'See logs at .../errors.log' for any non-CliError isUserError error"
---

# UX: gaslight --config missing file is ENOENT system chrome

## Summary

gaslight --config /tmp/no-gaslight.yaml: ENOENT open + See logs — should be ValidationError config not found.

## Evidence

ENOENT: no such file or directory, open '/tmp/no-gaslight.yaml' 

## Why it matters

UserError without logs; suggest gaslight install.

## Suggested direction

Config not found: path.

## Severity

Medium

## Area

Gaslight
