---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "Probe `npm run dev -- whoami` prints 'Unknown command: whoami' + 'Run npm run dev -- --help'; whoami is registered only as an auth child (src/cli/commands/auth.ts:38) while login/logout do get root aliases (src/cli/program.ts:879-880, src/cli/commands/login.ts:30, src/cli/commands/logout.ts:10), so no root whoami exists today."
comment: "Part of the missing-root-verb trio with 'version' and 'help'; consolidate into one aliasing change. Its case is the strongest of the three: whoami is a standard identity verb, auth whoami already works and returns clean JSON (ux-auth-whoami-field-shape-good.md), so a root alias is trivial. Its npm run dev half belongs to the identity cluster."
---

# UX: whoami only under auth, root whoami missing

## Summary

whoami at root → Unknown command + npm run dev; auth whoami works as JSON. Users expect top-level whoami.

## Evidence

```bash
$ poe-code whoami
■  Unknown command: whoami
$ poe-code auth whoami
{"user_id":…,"handle":"kamil",…}
```

## Why it matters

Discoverability; npm run dev recovery.

## Suggested direction

Root alias whoami → auth whoami; displayBinaryName.

## Severity

Medium

## Area

Auth / help
