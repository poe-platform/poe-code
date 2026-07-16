---
severity: medium
impact: usability
comment: "Member of the silent-defaults family; consolidate under the one rule - --yes announces every default it resolves. Its aggravating factor is worth noting: this default writes a file, so the silent choice has a filesystem side effect rather than just a config value. Its --force and --dry-run asks belong to the installer-flags umbrella."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:48-49 DEFAULT_PLAN_AGENT=claude-code, DEFAULT_PLAN_SCOPE=local; plan.ts:985,1014 return them under --yes; install command (plan.ts:755-760) registers only --agent/--local/--global, no --force; --dry-run exists globally at src/cli/program.ts:853"
---

# UX: plan install --yes defaults to claude and writes skill without force policy

## Summary

plan install --yes (no agent) defaults to claude-code local and Creates SKILL.md — silent default; no --force; no --dry-run on help.

## Evidence

```bash
$ poe-code plan install --yes
●  Create: .claude/skills/poe-code-plan/SKILL.md
◆  Installed plan skill for claude-code (local).
```

## Why it matters

Install side effects with silent agent default (same class as skill configure).

## Suggested direction

Require agent non-TTY; --dry-run; --force for reinstall.

## Severity

Medium

## Area

Plan / install
