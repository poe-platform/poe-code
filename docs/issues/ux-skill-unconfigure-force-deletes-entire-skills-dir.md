---
severity: critical
impact: data-loss
comment: "One of the two or three most serious files in the audit and correctly Critical: --force removed the entire .claude/skills tree, destroying four unrelated skills (experiment-plan, pipeline-plan, superintendent-plan, terminal-pilot) that poe-code did not install, restored only because the audit checked git. The help says 'Remove skill directories', which is technically true and catastrophically under-specific. Its fix list is exactly right and the first item is key: only remove poe-code-managed skills. Read with ux-skill-unconfigure-dry-run-path-inconsistent.md, which suggests the same command may also reach into the home directory - together they are the strongest argument in the audit for a blast-radius summary before destructive writes."
---

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
