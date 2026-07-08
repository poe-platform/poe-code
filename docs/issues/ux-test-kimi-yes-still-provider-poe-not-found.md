# UX: test kimi --yes still Provider poe not found (reconfirm)

## Summary

test kimi --yes without model still fails Provider poe not found in ~/.kimi/config.toml — --yes does not fix credential path.

## Evidence

Provider poe not found in providers … default_model poe/ki…

## Why it matters

Reconfirm kimi credential path still broken with --yes.

## Suggested direction

configure kimi must write valid providers.poe; test uses it.

## Severity

**High**

## Area

Test / kimi
