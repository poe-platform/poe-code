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
