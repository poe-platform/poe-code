# UX: install/test pi says Unknown agent not spawn-only

## Summary

install pi and test pi: Unknown agent "pi" + See logs — but spawn accepts pi. Capability matrix: should say pi is spawn-only, not unknown.

## Evidence

```bash
$ poe-code install pi --yes
■  Unknown agent "pi".
$ poe-code test pi
■  Unknown agent "pi".
$ poe-code spawn --help  # includes pi | pi-agent | poe-agent
```

## Why it matters

Reconfirm capability matrix messaging for spawn-only agents.

## Suggested direction

pi is spawn-only (not installable/testable). See spawn pi.

## Severity

**High**

## Area

Install / capability
