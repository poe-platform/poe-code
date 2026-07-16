---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/agent-skill-config/src/bridge-active-skills.ts:123-158 throws a plain Error (not CliError/isUserError), so src/cli/bootstrap.ts:71-81 prints 'Error: ...' plus the 'See logs at .../errors.log' line; message lists refs and 'searched paths:' but no install hint"
comment: "Duplicate of ux-skill-bridge-failure-lists-paths-good.md (same output, filed as defect rather than positive); consolidate. Both agree: the searched-paths list is exemplary and the See logs is wrong. Its 'suggest skill install --name' recovery is a good addition - the error tells users where it looked but not how to put a skill there."
---

# UX: spawn --skill missing lists searched paths but See logs

## Summary

spawn --skill no-such-skill: Failed to bridge active skills… Not found skill references; searched paths listed — good detail; still See logs.

## Evidence

Failed to bridge active skills: 1 skill reference(s) could not be resolved.
Not found: no-such-skill
searched paths: .poe-code/skills/… and ~/.poe-code/skills/…
●  See logs …

## Why it matters

UserError without logs; good path list.

## Suggested direction

UserError; suggest skill install --name.

## Severity

Medium

## Area

Spawn / skills
