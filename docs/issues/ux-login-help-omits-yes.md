---
severity: low-medium
impact: discoverability
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
