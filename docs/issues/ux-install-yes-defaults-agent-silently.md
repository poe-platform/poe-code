# UX: install --yes silently defaults to claude-code

## Summary

install --yes without agent installs Claude Code without stating default selection policy in the first line.

## Evidence

```bash
$ poe-code install --yes
◆  Installed Claude Code.
```

## Why it matters

Same silent default class as configure/skill configure.

## Suggested direction

Print Using default agent; document policy.

## Severity

Medium

## Area

Install
