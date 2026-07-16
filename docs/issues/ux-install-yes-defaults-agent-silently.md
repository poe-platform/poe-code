---
severity: medium
impact: usability
comment: "Duplicate of ux-install-yes-silently-defaults-to-claude.md; retire into it. Both belong to the silent-defaults family (ux-configure-yes-silent-default-agent.md, ux-skill-configure-yes-defaults-agent-silently.md) - one rule closes them all: --yes announces every default it resolves."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:1024-1027 resolveServiceArgument returns DEFAULT_SERVICE_AGENT ('claude-code', line 35) under flags.assumeYes with no announcement; global -y at src/cli/program.ts:852; duplicate of docs/issues/ux-install-yes-silently-defaults-to-claude.md"
---

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
