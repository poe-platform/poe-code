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
