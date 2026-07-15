---
severity: high
impact: discoverability
comment: "Duplicate within the kinds cluster; retire into ux-harness-new-kinds-undocumented-must-guess-demo-names.md. Its title is misleading and must not survive: coverage-demo is not the only kind that works - ux-harness-new-all-builtin-kinds-work.md proves all five scaffold - it was simply the only one this probe guessed correctly, which is itself evidence of the discoverability problem."
---

# UX: harness new kinds undocumented; only coverage-demo works of common names

## Summary

harness new --help says Built-in template kind with no list. coverage-demo works; agent-script, safejs, hello, counter all Unknown harness template.

## Evidence

```bash
$ poe-code harness new coverage-demo t --yes --dir /tmp/…
◆ Created…
$ poe-code harness new agent-script t --yes
■  Unknown harness template "agent-script".
```

## Why it matters

Discoverability of harness templates broken; error does not list kinds.

## Suggested direction

List kinds on help and on unknown-kind error.

## Severity

**High**

## Area

Harness
