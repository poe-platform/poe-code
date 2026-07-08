# UX: skill unconfigure --yes defaults agent and soft-blocks on non-empty dir

## Summary

skill unconfigure without agent defaults to claude-code and refuses non-empty skill dirs unless --force, but help does not make default agent or --force necessity obvious for non-TTY.

## Evidence

```bash
$ poe-code skill unconfigure --yes --local
▲  Skill directory for claude-code at .claude/skills has files. Use --force to remove.
```

## Why it matters

Silent default agent + two-step force is easy to get wrong in scripts.

## Suggested direction

Require agent or print Using default; document --force for non-empty; confirm on TTY.

## Severity

Medium

## Area

Skills
