---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- spawn poe-agent 'hi' --mode read => 'Error: fs.lstat is not a function'; poe-agent still listed in spawn --help agent choices; duplicate of ux-spawn-poe-agent-crashes-fs-lstat.md"
comment: "Third filing of the poe-agent crash; retire into ux-spawn-poe-agent-crashes-fs-lstat.md. Its 'memfs/fs injection' hypothesis is the most specific guess at the cause across the trio and is worth carrying into the canonical as a starting point."
---

# UX: spawn poe-agent still crashes fs.lstat (reconfirmed live)

## Summary

Live reconfirm: spawn poe-agent "hi" --mode read → fs.lstat is not a function + See logs.

## Evidence

```bash
$ poe-code spawn poe-agent "hi" --mode read
■  Error: fs.lstat is not a function
●  See logs …
```

## Why it matters

Advertised agent remains broken end-to-end.

## Suggested direction

Fix memfs/fs injection; or remove from spawn agent list until fixed.

## Severity

**High**

## Area

Spawn / poe-agent
