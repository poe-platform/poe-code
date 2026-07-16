---
severity: low-medium
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/commands/auth.ts:147 whoami writes process.stdout JSON.stringify(identity); src/cli/commands/auth.ts:92 status stops spinner with 'Logged in as ...' design-system output"
comment: "Keep as canonical of this pair. The observation is correct but it is not a defect: raw JSON is right for a machine path and a panel is right for a human one. The real gap is that nothing tells users which is which, so the split looks accidental rather than deliberate. Documentation is the fix - do not humanise whoami. Same underlying question as ux-auth-status-no-json-flag.md; decide the convention once."
---

# UX: auth whoami is raw JSON while auth status is design-system panel

## Summary

auth whoami dumps raw JSON identity; auth status uses design-system Logged in as. Dual presentation for same identity.

## Evidence

```bash
$ poe-code auth whoami
{"user_id":…,"handle":"kamil",…}
$ poe-code auth status
◆  Logged in as Kamil Jopek (@kamil)
```

## Why it matters

Scripting vs human modes need clear naming; whoami should be --json of status or documented machine mode.

## Suggested direction

Document whoami as machine-readable; status as human; or status --json.

## Severity

Low–Medium

## Area

Auth
