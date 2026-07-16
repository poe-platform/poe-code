---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/providers/poe-agent.ts:466 createConfigFileSystem returns only readFile/writeFile/mkdir cast to ConfigFileSystem; loadConfiguredPlugins store.get reaches packages/poe-code-config/src/store.ts:216 assertConfigPathSafe which calls fs.lstat, throwing TypeError before any model call; duplicate of ux-spawn-poe-agent-crashes-fs-lstat.md"
comment: "Reconfirm duplicate of ux-spawn-poe-agent-crashes-fs-lstat.md; retire into it. Rated High against that Critical for identical behavior; normalise. Its only addition is confirming the crash persists with an explicit model, which rules out the dead-default explanation - worth one line in the canonical."
---

# UX: spawn poe-agent still crashes fs.lstat (2026-07-08 reconfirm)

## Summary

spawn poe-agent --yes with haiku still: fs.lstat is not a function + See logs — Critical #18 still open.

## Evidence

```bash
$ poe-code spawn poe-agent "say only: ok" --mode read --model anthropic/claude-haiku-4.5 --yes
■  Error: fs.lstat is not a function
●  See logs …
```

## Why it matters

Reconfirm Critical poe-agent crash still open.

## Suggested direction

Fix fs mock/import; UserError if agent broken.

## Severity

**High**

## Area

Spawn / poe-agent
