---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/agent-skill-config/src/apply.ts:53-60 throws plain Error('Skill already exists: <path>') when an existing bundled skill 'poe-generate.md' differs from the template; src/cli/commands/skill.ts:194-199 registers configure with only --yes/--local/--global, no --force; bootstrap.ts:71-78 prefixes non-CliError with 'Error:' and appends 'See logs at .../errors.log', producing system-error chrome. Note: identical content is already idempotent, so global-vs-local divergence stems from differing existing file content."
comment: "Keep as canonical of this trio (best evidence: the global path fails on an existing skill while --local succeeds). Three problems compound: already-exists is treated as a system error rather than idempotent success, there is no --force, and global and local behave differently for the same command. Part of the installer-idempotency umbrella, and the rule from ux-config-init-already-exists-good.md settles it. Note the target is 'poe-generate.md', a skill the audit never mentions elsewhere - worth checking the default skill set is what users expect."
---

# UX: skill configure fails Skill already exists with system chrome

## Summary

skill configure claude-code --yes (global default) fails Skill already exists: ~/.claude/skills/poe-generate.md + See logs — no --force, no skip-if-exists info.

## Evidence

```bash
$ poe-code skill configure --yes
■  Error: Skill already exists: …/poe-generate.md
●  See logs …
$ poe-code skill configure claude-code --yes --local
◆  Configured skills for claude-code at ./.claude/skills
```

## Why it matters

Idempotent configure should skip or --force; global vs local inconsistency.

## Suggested direction

Skip existing with info; --force overwrite; no See logs.

## Severity

**High**

## Area

Skills
