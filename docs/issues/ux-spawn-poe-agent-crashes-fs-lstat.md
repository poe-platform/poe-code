---
severity: critical
impact: crash
comment: "Keep as canonical of this trio and correctly Critical: an agent advertised in spawn --help crashes immediately with 'fs.lstat is not a function', so a documented first-touch path is broken by an internal TypeError rather than any user error. Its framing is right - a broken advertised path is a trust failure - and its interim suggestion is pragmatic: hide poe-agent from help until fixed rather than leaving users to discover it. The error suggests an fs abstraction or memfs injection leaking into the real path."
---

# UX: spawn poe-agent fails with fs.lstat is not a function

## Summary

Featured agent on spawn --help (poe-agent) fails immediately with internal TypeError when users try documented one-shot path.

## Evidence

```bash
$ poe-code spawn poe-agent "say hi" --mode read
■  Error: fs.lstat is not a function
●  See logs …
```
spawn --help advertises poe-agent.

## Why it matters

Broken advertised path is P0 trust failure.

## Suggested direction

Fix fs abstraction; until fixed hide from help or clear error; cross-link poe-code agent.

## Severity

**Critical**

## Area

Spawn / poe-agent
