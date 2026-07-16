---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- login --help` prints only '--api-key <key>' and '-h, --help'; '-y, --yes' is a root-program option (src/cli/program.ts:852) and formatSubcommandHelp gates Global Options behind helper.showGlobalOptions (src/cli/program.ts:320), which is never enabled, while login still honours flags.assumeYes (src/cli/commands/login.ts:55)"
comment: "Duplicate within the login help cluster; retire. This is also an instance of the wider undocumented-global-flag problem (ux-global-flags-hidden-on-subcommand-help.md) rather than a login-specific omission - fixing global flag rendering closes the --yes half everywhere at once."
---

# UX: login --help omits --yes

## Summary

login help only --api-key and -h; --yes exists for non-TTY (login --yes without key message works) but undocumented.

## Evidence

login Options: --api-key, -h only.

## Why it matters

Non-TTY CI users need documented --yes.

## Suggested direction

Document --yes and POE_API_KEY.

## Severity

Low–Medium

## Area

Auth / help
