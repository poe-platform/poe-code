---
severity: medium
impact: usability
comment: "Instance of the bare-group family; retire into ux-many-parent-groups-only-dump-help.md, which enumerates all nine affected groups and names the in-product counterexamples. Its specific suggestion is good and worth carrying: the onboarding path here is configure-then-skill-configure, which nothing states."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:80 bare action calls this.help(); no addHelpText; `npm run dev -- skill` prints only install/configure/unconfigure with no next-step blurb. Duplicate of umbrella ux-many-parent-groups-only-dump-help.md."
---

# UX: bare `skill` only dumps help with no next-step guidance

## Summary

poe-code skill with no subcommand prints a bare subcommand list without suggesting the common onboarding path (skill configure after configure).

## Evidence

```bash
$ poe-code skill
# Commands: install, configure, unconfigure only
```

## Why it matters

First-time skill users need "configure directories for agent X" guidance.

## Suggested direction

Add next-step blurb or default to configure in TTY; examples on help.

## Severity

Medium

## Area

Skills / first-run
