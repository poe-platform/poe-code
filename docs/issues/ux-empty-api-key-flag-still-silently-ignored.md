---
severity: high
impact: correctness
comment: "Reconfirm of the empty --api-key issue on configure; retire into ux-empty-api-key-login-good-but-configure-ignores.md, which covers the same behavior with the decisive login contrast. Its one useful detail is that the existing Bearer still appears in the plan, confirming the empty flag is dropped rather than merely unused."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure-payload.ts:44 uses `flags.dryRun ? PREVIEW_API_KEY : resolveApiKey(...)`, skipping the empty-key rejection at src/cli/options.ts:100-102; `npm run dev -- configure claude --api-key \"\" --yes --dry-run` exits 0 and plans 'Authorization: Bearer <redacted>'. Duplicate of ux-empty-api-key-login-good-but-configure-ignores.md."
---

# UX: --api-key "" still silently ignored on configure (reconfirmed)

## Summary

configure … --api-key "" --yes --dry-run still plans config with existing Bearer (redacted) — empty explicit flag ignored rather than rejected.

## Evidence

configure --api-key "" still proceeds with redacted bearer from existing auth.

## Why it matters

Reconfirm empty explicit flags should error.

## Suggested direction

Reject empty --api-key when flag present.

## Severity

**High**

## Area

Configure / flags
