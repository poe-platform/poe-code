# UX: skill unconfigure --force deletes entire .claude/skills tree

## Summary

skill unconfigure claude --local --force --yes removed the whole .claude/skills directory including poe-code-experiment-plan, pipeline-plan, superintendent-plan, and terminal-pilot skills (restored from git after audit). Help says Remove skill directories — vastly broader than a single agent skill root wipe.

## Evidence

```bash
$ poe-code skill unconfigure claude --local --force --yes
◆  Removed skill directory for claude-code at .claude/skills
# git status: D all SKILL.md under .claude/skills/*
```
Skills restored via git checkout after probe.

## Why it matters

Destructive --force with no confirmation of multi-skill blast radius; can wipe unrelated project skills.

## Suggested direction

Only remove poe-code-managed skills or require explicit path; list files to delete; require --yes with blast-radius summary; never delete entire skills dir if other skills present.

## Severity

**Critical**

## Area

Skills / destructive
