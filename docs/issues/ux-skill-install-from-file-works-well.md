---
severity: low
impact: none
comment: "Good positive and a useful template: the success line names the skill, the agent and the resolved path - exactly what the bare-success commands omit (memory write, eval init). Its own suggestion to reuse the framing is the actionable half. Keep as the reference alongside ux-plan-install-success-good.md."
---

# UX: skill install --file success path is good (positive pattern)

## Summary

skill install with --file/--name/--yes/--local produces a clear design-system success naming agent and path — positive pattern to mirror for memory write/eval init.

## Evidence

```bash
$ poe-code skill install claude-code --file …/SKILL.md --name ux-audit-skill --yes --local
◆  Installed skill ux-audit-skill for claude-code at .claude/skills/ux-audit-skill/SKILL.md
```

## Why it matters

Documents a good success pattern for consistency audits.

## Suggested direction

Reuse this success framing for other install/write commands.

## Severity

Low

## Area

Skills / positive pattern
