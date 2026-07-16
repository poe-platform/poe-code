---
severity: medium
impact: usability
comment: "Contentless third filing of the same allow-list-plus-See-logs observation; retire into ux-hooks-from-unknown-lists-supported-good.md. The residual 'See logs' complaint belongs to ux-user-errors-look-like-system-failures.md."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-hook-config/src/bridge-hooks.ts:122 throws a plain Error (not CliError isUserError), so src/cli/bootstrap.ts:71-78 prints 'Error: ...' plus 'See logs at ~/.poe-code/logs/errors.log'; behaviour real but duplicate of ux-hooks-from-unknown-lists-supported-good.md and ux-user-errors-look-like-system-failures.md"
---

# UX: hooks-from unsupported system chrome

## Summary

Allow-list + See logs.

## Evidence

--hooks-from not-an-agent.

## Why it matters

Good content.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Spawn / hooks
