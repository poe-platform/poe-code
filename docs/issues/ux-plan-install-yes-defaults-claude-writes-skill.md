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
