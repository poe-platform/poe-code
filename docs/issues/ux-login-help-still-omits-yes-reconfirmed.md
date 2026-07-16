---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- login --help` prints only '--api-key <key>' and '-h, --help'; src/cli/commands/login.ts:31 registers only --api-key while -y/--yes is program-level (src/cli/program.ts:852) and consumed via flags.assumeYes (login.ts:56). Duplicate of docs/issues/ux-login-help-omits-yes.md."
comment: "Reconfirm duplicate within the login help cluster with no new evidence; retire. Five filings of one sparse help panel, spanning Low-Medium and Medium, is count inflation."
---

# UX: login --help still omits --yes (reconfirmed)

## Summary

login help only --api-key and -h — --yes works for non-TTY but undocumented (reconfirm).

## Evidence

login Options: --api-key, -h only.

## Why it matters

Reconfirm login help gap for CI.

## Suggested direction

Document --yes and POE_API_KEY.

## Severity

Low–Medium

## Area

Auth / help
