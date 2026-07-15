---
severity: low-medium
impact: discoverability
comment: "Keep of this pair as the one with the actionable ask. Correctly diagnosed: the per-agent paths (.agents/skills for goose, .claude/skills for claude) are right and undocumented, so users cannot find their skills without trial and error. A table of skill directories per agent is the fix, and it belongs with the capability-matrix work since it is the same 'per-agent facts live nowhere' problem."
---

# UX: skill configure goose writes ./.agents/skills without explaining layout

## Summary

skill configure goose --yes --local succeeds at ./.agents/skills while claude uses ./.claude/skills — path differences are correct per agent but not explained in success message or help.

## Evidence

```bash
$ poe-code skill configure goose --yes --local
◆  Configured skills for goose at ./.agents/skills
```
claude path was ./.claude/skills.

## Why it matters

Users hunting skills directories need to know agent-specific layouts.

## Suggested direction

Success message: path + one-line why; help table of skill dirs per agent.

## Severity

Low–Medium

## Area

Skills
