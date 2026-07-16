---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/login.ts:31 registers only --api-key; `npm run dev -- login --help` prints just '--api-key <key>' and '-h, --help' (no --yes, no POE_API_KEY, no non-TTY note). Duplicate of existing docs/issues/ux-login-help-omits-interactive-and-yes.md."
comment: "Duplicate within the login help cluster; retire into ux-login-help-omits-interactive-and-yes.md. Its distinct contribution is worth carrying: it links the help gap to the actual hang (ux-login-non-tty-hangs-reconfirmed.md), making documented non-TTY behavior a mitigation for a real defect rather than a docs nicety."
---

# UX: login --help still minimal (no --yes, no non-TTY guidance)

## Summary

login --help only --api-key and -h — no --yes, no note that non-TTY without key hangs/OAuth, no env POE_API_KEY mention.

## Evidence

login help: --api-key only.

## Why it matters

Login is entrypoint; help should document non-TTY and env.

## Suggested direction

Document --api-key required non-TTY; POE_API_KEY; no hang.

## Severity

Medium

## Area

Auth
